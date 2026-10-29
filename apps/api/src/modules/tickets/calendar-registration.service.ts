import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CalendarRegistrationRequest,
  CalendarRegistrationState,
  EventRegistrationClosedDetails,
  EventRegistrationClosedReason,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { TicketEvents } from './ticket-events';
import { TicketIssuer } from './ticket-issuer';
import { ticketRef } from './ticket-views';
import type { EventRegistrationDoc } from './tickets.collection';
import { type EventFacts, registrationGate, TICKETS_POLICY } from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

const closed = (reason: EventRegistrationClosedReason) => {
  const details: EventRegistrationClosedDetails = { reason };
  return domainError('EVENT_REGISTRATION_CLOSED', 409, details);
};

const distanceError = (code: 'REQUIRED' | 'INVALID') =>
  domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'distanceKm', code }] });

/** Дистанция регистрации: одна у старта — она; несколько — обязательна и из списка; нет — `null`. */
function distanceOf(event: EventFacts, requested: number | undefined): number | null {
  const options = event.distancesKm;
  if (options.length === 0) {
    if (requested !== undefined) throw distanceError('INVALID');
    return null;
  }
  if (requested === undefined) {
    if (options.length === 1) return options[0] ?? null;
    throw distanceError('REQUIRED');
  }
  if (!options.includes(requested)) throw distanceError('INVALID');
  return requested;
}

/**
 * Регистрация на старт календаря в «Покатим» (event-tickets): только включённые билеты, опубликованный старт, до
 * момента старта. Регистрация — транзакция: **первой** — `reserveSeat` (условный `$inc` счётчика мест в документе
 * настроек: две регистрации на последнее место конфликтуют), затем регистрация и билет (outbox письма). Одна активная
 * на пользователя (частичный уникальный индекс); повтор после отмены — новая регистрация и новый билет.
 */
@Injectable()
export class CalendarRegistrationService {
  private readonly logger = new Logger(CalendarRegistrationService.name);

  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
    private readonly issuer: TicketIssuer,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(userId: string, eventId: string): Promise<CalendarRegistrationState> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `tickets-read:${userId}`,
      TICKETS_POLICY.readLimit,
      now,
    );
    const event = await this.event(eventId);
    return this.state(event, await this.repository.activeRegistration(eventId, userId), now);
  }

  /** `created: false` — активная регистрация уже была (ответ 200 с ней). */
  async register(
    userId: string,
    eventId: string,
    body: CalendarRegistrationRequest,
  ): Promise<{ created: boolean; state: CalendarRegistrationState }> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `tickets-register:${userId}`,
      TICKETS_POLICY.registerLimit,
      now,
    );
    const event = await this.event(eventId);
    const existing = await this.repository.activeRegistration(eventId, userId);
    if (existing) return { created: false, state: await this.state(event, existing, now) };
    const reason = registrationGate(event, now);
    if (reason) throw closed(reason);
    const distanceKm = distanceOf(event, body.distanceKm);

    let outcome: { created: boolean; registration: EventRegistrationDoc };
    try {
      outcome = await this.issuer.inTransaction(async (tx, issue) => {
        // параллельный запрос того же райдера мог занять последнее место — его регистрация, не EVENT_FULL
        const own = await this.repository.activeRegistration(eventId, userId, tx);
        if (own) return { created: false, registration: own };
        const seat = await this.repository.reserveSeat(tx, eventId);
        if (!seat) {
          const settings = await this.repository.findTicketing('calendar', eventId, tx);
          if (settings?.enabled !== true) throw closed('not_enabled');
          throw domainError('EVENT_FULL', 409);
        }
        const doc: EventRegistrationDoc = {
          _id: uuidv7(),
          eventId,
          userId,
          distanceKm,
          status: 'active',
          createdAt: now,
          cancelledAt: null,
        };
        await this.repository.insertRegistration(tx, doc);
        await issue(tx, {
          kind: 'calendar',
          eventId,
          registrationId: doc._id,
          userId,
          category: { kind: 'calendar', distanceKm },
          now,
        });
        return { created: true, registration: doc };
      });
    } catch (error) {
      // параллельная регистрация того же пользователя уже прошла
      if (!isDuplicateKey(error, 'event_registrations_active_unique')) throw error;
      const winner = await this.repository.activeRegistration(eventId, userId);
      return { created: false, state: await this.state(event, winner, now) };
    }
    const { created, registration } = outcome;
    if (created) {
      this.logger.log(`tickets.registered event=${eventId} registration=${registration._id}`);
    }
    return { created, state: await this.state(event, registration, now) };
  }

  /**
   * Отмена — до момента старта и до отметки на check-in (`checked_in` — 409); активной нет — текущее состояние
   * (идемпотентно).
   */
  async cancel(userId: string, eventId: string): Promise<CalendarRegistrationState> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `tickets-register:${userId}`,
      TICKETS_POLICY.registerLimit,
      now,
    );
    const event = await this.event(eventId);
    const active = await this.repository.activeRegistration(eventId, userId);
    if (!active) return this.state(event, undefined, now);
    if (now.getTime() >= event.startsAt.getTime()) throw closed('started');
    await this.transactions.run(async (tx) => {
      // запись регистрации первой — конфликт с замком регистрации в транзакции check-in
      if (!(await this.repository.cancelRegistration(tx, active._id, now))) return;
      const ticket = await this.repository.findByRegistration(active._id, tx);
      // участник уже отмечен: отмена освободила бы место и дала второй билет (ревью pass 1, HIGH-2)
      if (ticket?.status === 'checked_in') throw closed('checked_in');
      await this.repository.cancelTicketOfRegistration(tx, active._id, now);
      await this.repository.releaseSeat(tx, eventId);
    });
    this.logger.log(`tickets.registration_cancelled event=${eventId} registration=${active._id}`);
    return this.state(event, undefined, now);
  }

  /** Старт календаря; нет — 404. */
  private async event(eventId: string): Promise<EventFacts> {
    const event = await this.events.resolve('calendar', eventId);
    if (!event) throw domainError('NOT_FOUND', 404);
    return event;
  }

  private async state(
    event: EventFacts,
    registration: EventRegistrationDoc | undefined,
    now: Date,
  ): Promise<CalendarRegistrationState> {
    if (!registration) return { registration: null, ticket: null };
    const ticket = await this.repository.findByRegistration(registration._id);
    return {
      registration: {
        id: registration._id,
        status: registration.status,
        distanceKm: registration.distanceKm,
        createdAt: registration.createdAt.toISOString(),
      },
      ticket: ticket ? ticketRef(ticket, event, now) : null,
    };
  }
}
