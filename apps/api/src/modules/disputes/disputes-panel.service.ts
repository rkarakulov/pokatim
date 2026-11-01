import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DisputeDecisionRequest,
  PanelDispute,
  PanelDisputeListItem,
  PanelDisputePage,
  PanelDisputeQuery,
  RateLimitedDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { PanelAudit, PanelDirectory, type PanelPrincipal } from '../panel';
import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { RESULTS_FOR_DISPUTES, type ResultsForDisputes } from '../results';
import type { DisputeDoc } from './disputes.collection';
import { DISPUTES_DISPUTE_DECIDED, type DisputeDecidedPayload } from './disputes.events';
import { decidableAt, decideBlock, DISPUTES_POLICY, filingClosesAt } from './disputes.policy';
import { DisputesRepository } from './disputes.repository';
import { disputeBlocked, disputeNotFound } from './disputes.service';

/** Курсор списка — только `id` последней строки; позицию `(filedAt, _id)` сервер читает из самого спора (RC-11). */
const CursorKey = z.literal('d');
const invalidCursor = () =>
  domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'cursor', code: 'INVALID' }] });

/** Общие поля строки списка и разбора (без имён). */
const listBase = (
  doc: DisputeDoc,
  title: string,
): Omit<PanelDisputeListItem, 'targetRiderName'> => ({
  id: doc._id,
  race: { id: doc.raceId, title },
  status: doc.status,
  category: doc.category,
  targetEntryId: doc.targetEntryId,
  complainantEntryId: doc.complainantEntryId,
  filedAt: doc.filedAt.toISOString(),
  decidableAt: decidableAt(doc.filedAt).toISOString(),
  responded: doc.response !== null,
});

/**
 * Строка списка: имя цели (Q2 profile.md) — только при имени и согласии; заявителя в списке нет. Имена в спор, журнал и
 * лог не пишутся.
 */
const listItem = (
  doc: DisputeDoc,
  title: string,
  names: ReadonlyMap<string, string>,
): PanelDisputeListItem => ({
  ...listBase(doc, title),
  targetRiderName: names.get(doc.targetUserId) ?? null,
});

/**
 * Споры в панели (race-results-06, `disputes.read` / `disputes.decide` — admin и moderator, все гонки: споры — работа
 * команды платформы, R1). Решение — транзакция: **первой** — `RaceRegistry.lockResults` (конфликт с подачей,
 * публикацией, отменой гонки и вторым решением), затем замок заявки-цели, переход спора из `open`, при «Удовлетворить» —
 * DQ (D-43) через порт `results`, история, outbox и журнал `disputes.decided` в той же транзакции. Лог — после коммита,
 * без заметки и `userId` райдеров. Имена сторон — порт `RIDER_NAMES` (один вызов на ответ), только в ответе.
 */
@Injectable()
export class DisputesPanelService {
  private readonly logger = new Logger(DisputesPanelService.name);

  constructor(
    private readonly repository: DisputesRepository,
    private readonly directory: PanelDirectory,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(RESULTS_FOR_DISPUTES) private readonly results: ResultsForDisputes,
    @Inject(RIDER_NAMES) private readonly riderNames: RiderNameDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Список по `filedAt` убыв.: фильтр статуса и гонки, курсор — id последней строки. */
  async list(query: PanelDisputeQuery): Promise<PanelDisputePage> {
    let after: { filedAt: Date; id: string } | null = null;
    if (query.cursor) {
      const { id } = decodeCursor(query.cursor, CursorKey);
      const at = await this.repository.findById(id);
      if (!at) throw invalidCursor();
      after = { filedAt: at.filedAt, id: at._id };
    }
    const docs = await this.repository.page(
      { status: query.status, raceId: query.raceId },
      after,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    // названия гонок страницы (обычно 1–3 различных, ≤ 50) — порт `RaceRegistry` (RC-15)
    const raceIds = [...new Set(page.map((doc) => doc.raceId))];
    const [races, names] = await Promise.all([
      Promise.all(raceIds.map((id) => this.races.get(id))),
      this.partyNames(page.map((doc) => doc.targetUserId)),
    ]);
    const titles = new Map(races.flatMap((race) => (race ? [[race.id, race.title] as const] : [])));
    const last = page.at(-1);
    return {
      items: page.map((doc) => listItem(doc, titles.get(doc.raceId) ?? '', names)),
      nextCursor: docs.length > query.limit && last ? encodeCursor('d', last._id) : null,
    };
  }

  /** Разбор спора: заявление, ответ участника, оспоренный результат, история, решение. */
  async get(id: string): Promise<PanelDispute> {
    const doc = await this.repository.findById(id);
    if (!doc) throw disputeNotFound();
    const race = await this.race(doc.raceId);
    const [standing, events, names, riders] = await Promise.all([
      this.results.standing(race, doc.targetEntryId),
      this.repository.listEvents(doc._id),
      this.directory.displayNames(doc.decision ? [doc.decision.actorUserId] : []),
      this.partyNames([doc.targetUserId, doc.complainantUserId]),
    ]);
    const blockedBy = decideBlock(doc, race, this.clock.now());
    return {
      ...listBase(doc, race.title),
      description: doc.description,
      response: doc.response
        ? { text: doc.response.text, at: doc.response.at.toISOString() }
        : null,
      target: {
        entryId: doc.targetEntryId,
        userId: doc.targetUserId,
        riderName: riders.get(doc.targetUserId) ?? null,
        resultStatus: standing?.resultStatus ?? 'none',
        place: standing?.place ?? null,
        tied: standing?.tied ?? false,
        elapsedSec: standing?.elapsedSec ?? null,
        tier: standing?.tier ?? 'verified',
        groupKey: standing?.groupKey ?? doc.groupKey,
        flags: standing?.flags ?? [],
      },
      complainant: {
        entryId: doc.complainantEntryId,
        userId: doc.complainantUserId,
        riderName: riders.get(doc.complainantUserId) ?? null,
      },
      decision: doc.decision
        ? {
            outcome: doc.decision.outcome,
            template: doc.decision.template,
            note: doc.decision.note,
            actor: {
              userId: doc.decision.actorUserId,
              displayName: names.get(doc.decision.actorUserId) ?? '',
            },
            at: doc.decision.at.toISOString(),
          }
        : null,
      events: events.map((event) => ({
        kind: event.kind,
        actorKind: event.actor.kind,
        at: event.at.toISOString(),
      })),
      filingClosesAt: filingClosesAt(race).toISOString(),
      protocolPlannedAt: race.protocolPlannedAt.toISOString(),
      canDecide: blockedBy === null,
      decideBlockedBy: blockedBy,
    };
  }

  /**
   * Решение (D-43, D-25): «Удовлетворить» — DQ результата цели (вне мест, при публикации строка `dq`), «Отклонить» —
   * без изменений. Раньше `filedAt + 12 ч` — `too_early` с `availableAt`; закрытый — `not_open`.
   */
  async decide(
    principal: PanelPrincipal,
    id: string,
    body: DisputeDecisionRequest,
  ): Promise<PanelDispute> {
    const now = this.clock.now();
    await this.limit(principal.userId, now);
    const snapshot = await this.repository.findById(id);
    if (!snapshot) throw disputeNotFound();
    await this.transactions.run(async (tx) => {
      const race = await this.races.lockResults(tx, snapshot.raceId);
      if (!race) throw disputeNotFound();
      const dispute = await this.repository.findById(id, tx);
      if (!dispute) throw disputeNotFound();
      const blocked = decideBlock(dispute, race, now);
      if (blocked === 'too_early') throw disputeBlocked(blocked, decidableAt(dispute.filedAt));
      if (blocked) throw disputeBlocked(blocked);
      await this.results.lockEntry(tx, dispute.targetEntryId, now);
      const decision = {
        outcome: body.outcome,
        template: body.template,
        note: body.note ?? null,
        actorUserId: principal.userId,
        at: now,
      };
      const decided = await this.repository.decide(tx, id, decision, now);
      if (!decided) throw disputeBlocked('not_open');
      if (body.outcome === 'upheld') {
        // идемпотентно: цель уже DQ по другому спору — без второй записи журнала пересчётов
        await this.results.disqualify(tx, {
          raceId: race.id,
          entryId: dispute.targetEntryId,
          disputeId: id,
          actorUserId: principal.userId,
          at: now,
        });
      }
      await this.repository.insertEvent(tx, {
        _id: uuidv7(),
        disputeId: id,
        raceId: race.id,
        kind: 'decided',
        actor: { kind: 'staff', userId: principal.userId },
        at: now,
        payload: { outcome: body.outcome, template: body.template },
      });
      const payload: DisputeDecidedPayload = {
        disputeId: id,
        raceId: race.id,
        outcome: body.outcome,
      };
      await this.outbox.append(tx, { type: DISPUTES_DISPUTE_DECIDED, payload });
      await this.audit.append(tx, {
        action: 'disputes.decided',
        actor: { kind: 'user', userId: principal.userId },
        reason: decision.note ?? decision.template,
        subject: { kind: 'race', id: race.id, label: race.title },
        details: { disputeId: id, entryId: dispute.targetEntryId },
      });
    });
    this.logger.log(
      `disputes.decided dispute=${id} race=${snapshot.raceId} outcome=${body.outcome}`,
    );
    return this.get(id);
  }

  /** Имена сторон одним вызовом порта: список — только цели, разбор — цель и заявитель (пустой вход — без запроса). */
  private partyNames(userIds: readonly string[]): Promise<Map<string, string>> {
    return this.riderNames.publicNames([...new Set(userIds)]);
  }

  private async race(raceId: string): Promise<RaceForResults> {
    const race = await this.races.get(raceId);
    if (!race) throw disputeNotFound();
    return race;
  }

  private async limit(staffId: string, now: Date): Promise<void> {
    const result = await this.rateLimiter.consume(
      `disputes-panel-user:${staffId}`,
      DISPUTES_POLICY.panelUserLimit,
      now,
    );
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }
}
