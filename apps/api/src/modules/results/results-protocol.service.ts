import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AuditAction,
  PanelRaceAttempt,
  PanelRaceResults,
  ProtocolEntryActionRequest,
  RecalculationKind,
  ResultsActionBlock,
  ResultsActionBlockedDetails,
  ResultsActionRequest,
  ResultsPublishBlockedDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { PanelAudit, type PanelPrincipal } from '../panel';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { AttemptIntake } from './attempt-intake';
import { consumeUserLimit } from './entries.service';
import type {
  RaceAttemptDoc,
  RaceAttemptReviewDoc,
  RaceProtocolRowDoc,
} from './results.collection';
import {
  RESULTS_PROTOCOL_PUBLISHED,
  RESULTS_RACE_RECHECK_REQUESTED,
  RESULTS_RESULT_REVISED,
} from './results.events';
import { buildProtocol, recheckPending, RESULTS_POLICY } from './results.policy';
import { protocolBaseOf, ResultsPanelReadService } from './results-panel-read.service';
import { ResultsRepository } from './results.repository';

const notFound = () => domainError('NOT_FOUND', 404);
const blocked = (reason: ResultsActionBlock, count?: number) => {
  const details: ResultsActionBlockedDetails = count === undefined ? { reason } : { reason, count };
  return domainError('RESULTS_ACTION_BLOCKED', 409, details);
};

type Revision = Extract<
  RecalculationKind,
  'disqualified' | 'disqualification_revoked' | 'recheck_applied'
>;

const REVISION_AUDIT: Record<Revision, AuditAction> = {
  disqualified: 'results.result_disqualified',
  disqualification_revoked: 'results.disqualification_revoked',
  recheck_applied: 'results.recalculation_applied',
};

const baseOf = protocolBaseOf;

/**
 * Действия панели над протоколом гонки (race-results-05, D-22…D-28): исключение и возврат трека, перепроверка,
 * публикация, DQ и отмена DQ, применение перепроверки. Клиент присылает намерение и причину; места, статусы, ревизии
 * и чек-лист считает сервер. Каждое действие — одна транзакция, **первая** операция которой — замок результатов гонки
 * (`RaceRegistry.lockResults`): действия одной гонки, её отмена и правка конфликтуют, проигравшая повторяется на
 * свежем снимке. Журнал — `PanelAudit.append` в той же транзакции; лог — после коммита, без причины и `userId` райдера.
 */
@Injectable()
export class ResultsProtocolService {
  private readonly logger = new Logger(ResultsProtocolService.name);

  constructor(
    private readonly repository: ResultsRepository,
    private readonly read: ResultsPanelReadService,
    private readonly intake: AttemptIntake,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly audit: PanelAudit,
    private readonly rateLimiter: RateLimiter,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** «Исключить трек» до публикации (D-24): `queued…failed` → `excluded`; dead-letter снимается так же (D-23). */
  async exclude(
    principal: PanelPrincipal,
    raceId: string,
    attemptId: string,
    { reason }: ResultsActionRequest,
  ): Promise<PanelRaceAttempt> {
    await this.prepare(principal, raceId);
    const { attempt, review } = await this.transactions.run(async (tx) => {
      const { race, entry, now } = await this.lockAttempt(tx, raceId, attemptId);
      const excluded = await this.repository.excludeAttempt(tx, raceId, attemptId, now);
      if (!excluded) throw blocked('attempt_state');
      const doc = await this.review(tx, principal, excluded, 'excluded', reason, now);
      await this.repository.refreshEntry(tx, entry);
      await this.journal(tx, principal, race, 'results.attempt_excluded', reason, {
        attemptId,
        entryId: excluded.entryId,
      });
      return { attempt: excluded, review: doc };
    });
    this.logger.log(`race ${raceId}: attempt ${attemptId} excluded`);
    return this.read.namedAttemptView(attempt, review);
  }

  /** «Вернуть в обработку» до публикации: `excluded` → новая ревизия `queued` и событие проверки (D-24). */
  async restore(
    principal: PanelPrincipal,
    raceId: string,
    attemptId: string,
    { reason }: ResultsActionRequest,
  ): Promise<PanelRaceAttempt> {
    await this.prepare(principal, raceId);
    const { attempt, review } = await this.transactions.run(async (tx) => {
      const { race, entry, now } = await this.lockAttempt(tx, raceId, attemptId);
      const requeued = await this.repository.requeueAttempt(tx, attemptId, now, {
        statusIn: ['excluded'],
      });
      if (!requeued) throw blocked('attempt_state');
      await this.intake.queueCheck(tx, requeued);
      const doc = await this.review(tx, principal, requeued, 'restored', reason, now);
      await this.repository.refreshEntry(tx, entry);
      await this.journal(tx, principal, race, 'results.attempt_restored', reason, {
        attemptId,
        entryId: requeued.entryId,
      });
      return { attempt: requeued, review: doc };
    });
    this.logger.log(`race ${raceId}: attempt ${attemptId} restored`);
    return this.read.namedAttemptView(attempt, review);
  }

  /**
   * «Перепроверить треки» (RC-1): запись `recheck_started` и событие для worker — попытки перепоставляются там. До
   * публикации — `results.manage` (`after: false`), после — `results.revise` (`after: true`); снимок протокола не
   * меняется до «Применить пересчёт».
   */
  async requestRecheck(
    principal: PanelPrincipal,
    raceId: string,
    { reason }: ResultsActionRequest,
    { after }: { after: boolean },
  ): Promise<PanelRaceResults> {
    await this.prepare(principal, raceId);
    await this.transactions.run(async (tx) => {
      const { race, now } = await this.lockRace(tx, raceId);
      const published = race.protocolPublishedAt !== null;
      if (!after && published) throw blocked('protocol_published');
      if (after && !published) throw blocked('protocol_not_published');
      await this.repository.insertRecalculation(tx, {
        _id: uuidv7(),
        raceId,
        kind: 'recheck_started',
        entryId: null,
        revision: null,
        reason,
        actorUserId: principal.userId,
        at: now,
      });
      await this.outbox.append(tx, {
        type: RESULTS_RACE_RECHECK_REQUESTED,
        payload: { raceId, requestedAt: now.toISOString() },
      });
      const revision = published ? await this.currentRevision(tx, raceId) : undefined;
      await this.journal(tx, principal, race, 'results.recheck_requested', reason, {
        ...(revision === undefined ? {} : { revision }),
      });
    });
    this.logger.log(`race ${raceId}: recheck requested (${after ? 'after' : 'before'} protocol)`);
    return this.summary(principal, raceId);
  }

  /**
   * Публикация протокола (D-22, D-23): чек-лист — в той же транзакции и той же функцией, что видит панель; не пуст
   * или гонка не публикуема — `RESULTS_PUBLISH_BLOCKED`. Ревизия 1 — строки активных заявок с лучшим результатом
   * (DQ по спору до публикации — строкой `dq` без места, race-results-06).
   */
  async publish(
    principal: PanelPrincipal,
    raceId: string,
    { reason }: ResultsActionRequest,
  ): Promise<PanelRaceResults> {
    await this.prepare(principal, raceId);
    const rows = await this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const race = await this.races.lockResults(tx, raceId);
      if (!race) throw notFound();
      const { publish } = await this.read.checks(race, now, tx);
      if (!publish.canPublish) {
        const details: ResultsPublishBlockedDetails = {
          blockedBy: publish.blockedBy,
          checklist: publish.checklist,
        };
        throw domainError('RESULTS_PUBLISH_BLOCKED', 409, details);
      }
      // база — заявки с лучшим, включая DQ по спору до публикации (RC-2): DQ получает строку `dq` без места
      const disqualified = await this.repository.disqualifiedEntries(raceId, tx);
      const base = await this.repository.protocolBaseEntries(raceId, tx);
      const protocol = buildProtocol(
        base.map((entry) => baseOf(entry, disqualified.has(entry._id))),
        null,
      );
      await this.writeRevision(tx, principal, race, 1, protocol, now, {
        kind: 'published',
        entryId: null,
        reason,
      });
      if (!(await this.races.markProtocolPublished(tx, raceId, now))) {
        throw blocked('protocol_published');
      }
      await this.outbox.append(tx, {
        type: RESULTS_PROTOCOL_PUBLISHED,
        payload: { raceId, revision: 1 },
      });
      await this.journal(tx, principal, race, 'results.protocol_published', reason, {
        revision: 1,
      });
      return protocol.length;
    });
    this.logger.log(`race ${raceId}: protocol published, revision 1, ${rows} rows`);
    return this.summary(principal, raceId);
  }

  /** DQ участника (D-27): новая ревизия по строкам текущей, время не меняется. */
  disqualify(
    principal: PanelPrincipal,
    raceId: string,
    input: ProtocolEntryActionRequest,
  ): Promise<PanelRaceResults> {
    return this.toggleDisqualification(principal, raceId, input, true);
  }

  /** Отмена DQ (D-28): место возвращается новой ревизией (`revised`). */
  revokeDisqualification(
    principal: PanelPrincipal,
    raceId: string,
    input: ProtocolEntryActionRequest,
  ): Promise<PanelRaceResults> {
    return this.toggleDisqualification(principal, raceId, input, false);
  }

  /**
   * «Применить пересчёт» (R3): есть запуск перепроверки после публикации, новее применения (`recheck_not_started`);
   * незавершённых проверок нет (`checks_pending` с числом). Новая ревизия — по текущим лучшим результатам заявок с
   * действующими DQ из журнала пересчётов; участник без лучшего выпадает из протокола, его DQ сохраняется.
   */
  async applyRecheck(
    principal: PanelPrincipal,
    raceId: string,
    { reason }: ResultsActionRequest,
  ): Promise<PanelRaceResults> {
    await this.prepare(principal, raceId);
    const revision = await this.transactions.run(async (tx) => {
      const { race, now } = await this.lockRace(tx, raceId);
      if (race.protocolPublishedAt === null) throw blocked('protocol_not_published');
      const last = await this.repository.lastRecheck(raceId, tx);
      if (!recheckPending(last, race.protocolPublishedAt)) throw blocked('recheck_not_started');
      const checks = await this.repository.pendingChecks(raceId, last.startedAt, tx);
      const pending = checks.queued + checks.checking + checks.stale;
      if (pending > 0) throw blocked('checks_pending', pending);
      const current = await this.currentRevision(tx, raceId);
      const previous = await this.repository.protocolRows(raceId, current, tx);
      // DQ — по журналу пересчётов: выпавший из прошлой ревизии участник с DQ не возвращается с местом
      const disqualified = await this.repository.disqualifiedEntries(raceId, tx);
      const base = await this.repository.protocolBaseEntries(raceId, tx);
      const protocol = buildProtocol(
        base.map((entry) => baseOf(entry, disqualified.has(entry._id))),
        new Map(previous.map((row) => [row.entryId, row])),
      );
      return this.revise(tx, principal, race, current + 1, protocol, now, {
        kind: 'recheck_applied',
        entryId: null,
        reason,
      });
    });
    this.logger.log(`race ${raceId}: recheck applied, revision ${revision}`);
    return this.summary(principal, raceId);
  }

  private async toggleDisqualification(
    principal: PanelPrincipal,
    raceId: string,
    { entryId, reason }: ProtocolEntryActionRequest,
    dq: boolean,
  ): Promise<PanelRaceResults> {
    await this.prepare(principal, raceId);
    const revision = await this.transactions.run(async (tx) => {
      const { race, now } = await this.lockRace(tx, raceId);
      if (race.protocolPublishedAt === null) throw blocked('protocol_not_published');
      const current = await this.currentRevision(tx, raceId);
      const rows = await this.repository.protocolRows(raceId, current, tx);
      const row = rows.find((candidate) => candidate.entryId === entryId);
      if (!row || (row.status === 'dq') === dq) throw blocked('row_state');
      const protocol = buildProtocol(
        rows.map((candidate) => ({
          entryId: candidate.entryId,
          userId: candidate.userId,
          attemptId: candidate.attemptId,
          elapsedSec: candidate.elapsedSec,
          startedAt: candidate.startedAt,
          dq: candidate.entryId === entryId ? dq : candidate.status === 'dq',
          // race-results-07: строки ревизий до 07 — `overall`; датчики — из снимка, скорость — заново (`buildProtocol`)
          groupKey: candidate.groupKey ?? 'overall',
          flags: candidate.flags ?? [],
        })),
        new Map(rows.map((candidate) => [candidate.entryId, candidate])),
      );
      return this.revise(tx, principal, race, current + 1, protocol, now, {
        kind: dq ? 'disqualified' : 'disqualification_revoked',
        entryId,
        reason,
      });
    });
    this.logger.log(`race ${raceId}: ${dq ? 'disqualified' : 'dq revoked'}, revision ${revision}`);
    return this.summary(principal, raceId);
  }

  /** Новая ревизия опубликованного протокола: строки, журнал пересчётов, событие для рейтинга (08), журнал. */
  private async revise(
    tx: DbSession,
    principal: PanelPrincipal,
    race: RaceForResults,
    revision: number,
    protocol: ReturnType<typeof buildProtocol>,
    now: Date,
    change: { kind: Revision; entryId: string | null; reason: string },
  ): Promise<number> {
    await this.writeRevision(tx, principal, race, revision, protocol, now, change);
    await this.outbox.append(tx, {
      type: RESULTS_RESULT_REVISED,
      payload: { raceId: race.id, revision, kind: change.kind, entryId: change.entryId },
    });
    await this.journal(tx, principal, race, REVISION_AUDIT[change.kind], change.reason, {
      revision,
      ...(change.entryId ? { entryId: change.entryId } : {}),
    });
    return revision;
  }

  /** Строки ревизии и запись журнала пересчётов (уникальная ревизия гонки, RC-2) — только вставки. */
  private async writeRevision(
    tx: DbSession,
    principal: PanelPrincipal,
    race: RaceForResults,
    revision: number,
    protocol: ReturnType<typeof buildProtocol>,
    now: Date,
    change: { kind: RecalculationKind; entryId: string | null; reason: string },
  ): Promise<void> {
    const rows: RaceProtocolRowDoc[] = protocol.map((row) => ({
      _id: uuidv7(),
      raceId: race.id,
      revision,
      ...row,
      createdAt: now,
    }));
    await this.repository.insertProtocolRows(tx, rows);
    await this.repository.insertRecalculation(tx, {
      _id: uuidv7(),
      raceId: race.id,
      kind: change.kind,
      entryId: change.entryId,
      revision,
      reason: change.reason,
      actorUserId: principal.userId,
      at: now,
    });
  }

  /** Лимит мутаций сотрудника и видимость гонки (чужая гонка организатора — 404) — до транзакции. */
  private async prepare(principal: PanelPrincipal, raceId: string): Promise<void> {
    await consumeUserLimit(
      this.rateLimiter,
      `results-panel-user:${principal.userId}`,
      RESULTS_POLICY.panelUserLimit,
      this.clock.now(),
    );
    await this.read.race(principal, raceId);
  }

  /** Замок результатов гонки — первая операция транзакции; черновик и неизвестная — 404, отменённая — 409. */
  private async lockRace(
    tx: DbSession,
    raceId: string,
  ): Promise<{ race: RaceForResults; now: Date }> {
    const now = this.clock.now();
    const race = await this.races.lockResults(tx, raceId);
    if (!race) throw notFound();
    if (race.status === 'cancelled') throw blocked('race_cancelled');
    return { race, now };
  }

  /** Замок гонки (не опубликован протокол), попытка этой гонки и замок её заявки. */
  private async lockAttempt(tx: DbSession, raceId: string, attemptId: string) {
    const { race, now } = await this.lockRace(tx, raceId);
    if (race.protocolPublishedAt !== null) throw blocked('protocol_published');
    const attempt = await this.repository.findAttempt(attemptId, tx);
    if (attempt?.raceId !== raceId) throw notFound();
    const entry = await this.repository.lockEntry(tx, attempt.entryId, now);
    if (!entry) throw notFound();
    return { race, entry, now };
  }

  private async review(
    tx: DbSession,
    principal: PanelPrincipal,
    attempt: RaceAttemptDoc,
    kind: RaceAttemptReviewDoc['kind'],
    reason: string,
    at: Date,
  ): Promise<RaceAttemptReviewDoc> {
    const doc: RaceAttemptReviewDoc = {
      _id: uuidv7(),
      raceId: attempt.raceId,
      entryId: attempt.entryId,
      attemptId: attempt._id,
      kind,
      reason,
      actorUserId: principal.userId,
      at,
    };
    await this.repository.insertReview(tx, doc);
    return doc;
  }

  private async currentRevision(tx: DbSession, raceId: string): Promise<number> {
    return (await this.repository.currentRevision(raceId, tx)) ?? 1;
  }

  private journal(
    tx: DbSession,
    principal: PanelPrincipal,
    race: RaceForResults,
    action: AuditAction,
    reason: string,
    details: { attemptId?: string; entryId?: string; revision?: number },
  ): Promise<void> {
    return this.audit.append(tx, {
      action,
      actor: { kind: 'user', userId: principal.userId },
      reason,
      subject: { kind: 'race', id: race.id, label: race.title },
      details,
    });
  }

  private async summary(principal: PanelPrincipal, raceId: string): Promise<PanelRaceResults> {
    return this.read.summaryOf(await this.read.race(principal, raceId));
  }
}
