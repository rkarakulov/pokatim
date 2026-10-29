import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MyTicketRef } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { IdentityAccounts } from '../identity';
import { RESULTS_FOR_TICKETS, type ResultsForTickets, type TicketEntry } from '../results';
import { TicketEvents } from './ticket-events';
import { TicketIssuer } from './ticket-issuer';
import { ticketRef } from './ticket-views';
import type { TicketDoc } from './tickets.collection';
import {
  canIssue,
  type EventFacts,
  isPast,
  type PlanEntry,
  raceReconcilePlan,
  type RaceReconcilePlan,
  TICKETS_POLICY,
} from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

/** Сверка нужна, пока возможен выпуск (окно check-in) или отмена участия (окно гонки + сутки). */
const needsReconcile = (event: EventFacts, now: Date) =>
  !isPast(event, now) ||
  (event.windowClosesAt !== null &&
    now.getTime() < event.windowClosesAt.getTime() + TICKETS_POLICY.reconcileAfterWindowMs);

const planEntry = (entry: TicketEntry): PlanEntry => ({
  entryId: entry.entryId,
  userId: entry.userId,
  status: entry.status,
  category: { kind: 'race', tier: entry.tier, groupKey: entry.groupKey },
});

/** Итог сверки гонки. */
export interface RaceReconcileRun {
  issued: number;
  cancelled: number;
  recategorized: number;
}

/** Итог регламента. */
export interface TicketsReconcileRun {
  races: number;
  issued: number;
  failed: number;
}

/**
 * Билеты гонок (event-tickets, §5.1): `results` о билетах не знает (outbox `results.*` маршрутизирован в
 * `results-intake`, зависимость `results → tickets` — цикл), поэтому билет выпускается **сверкой** заявок с билетами:
 * лениво при чтении (`GET /v1/races/:raceId/ticket`) и регламентом worker раз в минуту. Один класс для HTTP и
 * worker (`TicketsCoreModule`). Дубль выпуска (параллельные чтение и сверка) ловит `tickets_registration_unique`.
 */
@Injectable()
export class RaceTickets {
  private readonly logger = new Logger(RaceTickets.name);

  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
    private readonly issuer: TicketIssuer,
    private readonly identity: IdentityAccounts,
    private readonly rateLimiter: RateLimiter,
    @Inject(RESULTS_FOR_TICKETS) private readonly results: ResultsForTickets,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Свой билет гонки (лимит `tickets-read:<uid>` → гонка (нет, черновик — 404) → заявка → сверка этой заявки).
   * Нет заявки или билеты не выпускаются — `null`.
   */
  async myTicket(userId: string, raceId: string): Promise<MyTicketRef | null> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `tickets-read:${userId}`,
      TICKETS_POLICY.readLimit,
      now,
    );
    const event = await this.events.resolve('race', raceId);
    if (!event) throw domainError('NOT_FOUND', 404);
    const entry = await this.results.entryOf(userId, raceId);
    if (!entry) return null;
    const existing = await this.repository.findByRegistration(entry.entryId);
    await this.apply(
      event,
      raceReconcilePlan([planEntry(entry)], existing ? [existing] : [], event, now),
      now,
    );
    const ticket = await this.repository.findByRegistration(entry.entryId);
    return ticket ? ticketRef(ticket, event, now) : null;
  }

  /**
   * Свежий статус билета гонки перед показом и check-in: заявка снята, а сверка ещё не прошла — билет отменяется
   * сейчас (QR не пройдёт). Билет календаря и неактивный — как есть.
   */
  async refresh(ticket: TicketDoc): Promise<TicketDoc> {
    if (ticket.kind !== 'race' || ticket.status !== 'active') return ticket;
    const entry = await this.results.entryOf(ticket.userId, ticket.eventId);
    if (entry && entry.entryId === ticket.registrationId && entry.status === 'active')
      return ticket;
    await this.repository.cancelTicket(ticket._id, this.clock.now());
    return (await this.repository.findTicket(ticket._id)) ?? ticket;
  }

  /**
   * Сверка гонки: заявки пачками по 500 → план → выпуск (только живым аккаунтам, RC-T1), отмена, новая категория.
   * Нет гонки — нули.
   */
  async reconcileRace(raceId: string): Promise<RaceReconcileRun> {
    const now = this.clock.now();
    const run: RaceReconcileRun = { issued: 0, cancelled: 0, recategorized: 0 };
    const event = await this.events.resolve('race', raceId);
    if (!event) return run;
    let afterId: string | null = null;
    for (;;) {
      const entries = await this.results.entriesPage(
        raceId,
        afterId,
        TICKETS_POLICY.reconcileBatch,
      );
      if (entries.length === 0) break;
      afterId = entries.at(-1)!.entryId;
      const tickets = await this.repository.ticketsByRegistrations(entries.map((e) => e.entryId));
      const plan = raceReconcilePlan(entries.map(planEntry), tickets, event, now);
      if (plan.issue.length > 0) {
        const live = await this.identity.liveUserIds(plan.issue.map((entry) => entry.userId));
        plan.issue = plan.issue.filter((entry) => live.has(entry.userId));
      }
      const done = await this.apply(event, plan, now);
      run.issued += done.issued;
      run.cancelled += done.cancelled;
      run.recategorized += done.recategorized;
      if (entries.length < TICKETS_POLICY.reconcileBatch) break;
    }
    return run;
  }

  /**
   * Регламент (`tickets.reconcile`): гонки с включёнными билетами, не отменённые, пока не закрылось окно check-in
   * (выпуск и отмены) или окно гонки + сутки (только отмены снятых заявок и смена группы). Отказ
   * гонки — лог `tickets.reconcile_failed race=<id>`, остальные идут; в конце — исключение (failed-набор BullMQ).
   */
  async reconcileAll(): Promise<TicketsReconcileRun> {
    const now = this.clock.now();
    const run: TicketsReconcileRun = { races: 0, issued: 0, failed: 0 };
    const settings = await this.repository.enabledRaceTicketings(
      new Date(now.getTime() - TICKETS_POLICY.reconcileLookbackMs),
    );
    const events = await this.events.resolveMany(
      settings.map((doc) => ({ kind: 'race' as const, id: doc.eventId })),
    );
    for (const event of events.values()) {
      // выпуск ограничен окном check-in (`canIssue` в плане); отмены снятых заявок — пока открыто окно гонки (+ сутки)
      if (!event.published || !needsReconcile(event, now)) continue;
      run.races += 1;
      try {
        run.issued += (await this.reconcileRace(event.id)).issued;
      } catch (error) {
        run.failed += 1;
        this.logger.error(`tickets.reconcile_failed race=${event.id}`, error);
      }
    }
    if (run.failed > 0) throw new Error(`tickets.reconcile: ${run.failed} race(s) failed`);
    return run;
  }

  private async apply(
    event: EventFacts,
    plan: RaceReconcilePlan,
    now: Date,
  ): Promise<RaceReconcileRun> {
    const run: RaceReconcileRun = { issued: 0, cancelled: 0, recategorized: 0 };
    for (const entry of plan.issue) {
      // длинная сверка не выпускает билеты после закрытия окна (ревью Codex pass 4): срок — по текущим часам
      const issuedAt = this.clock.now();
      if (!canIssue(event, issuedAt)) break;
      try {
        const ticket = await this.issuer.inTransaction((tx, issue) =>
          issue(tx, {
            kind: 'race',
            eventId: event.id,
            registrationId: entry.entryId,
            userId: entry.userId,
            category: entry.category,
            now: issuedAt,
          }),
        );
        run.issued += 1;
        this.logger.log(`tickets.issued ticket=${ticket._id} race=${event.id}`);
      } catch (error) {
        // параллельная сверка или чтение уже выпустили билет этой заявки
        if (!isDuplicateKey(error, 'tickets_registration_unique')) throw error;
      }
    }
    for (const ticketId of plan.cancel) {
      if (await this.repository.cancelTicket(ticketId, now)) run.cancelled += 1;
    }
    for (const { ticketId, category } of plan.recategorize) {
      await this.repository.setCategory(ticketId, category);
      run.recategorized += 1;
    }
    return run;
  }
}
