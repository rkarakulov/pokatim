import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AttemptOrigin } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { ROUTE_GEOMETRY, type RouteGeometry } from '../routes';
import { ACTIVITY_SOURCE, type ActivityRef, type ActivitySource } from '../tracks';
import type { RaceAttemptDoc, RaceEntryDoc } from './results.collection';
import { RESULTS_ATTEMPT_CHECK_REQUESTED } from './results.events';
import { mayMatch, raceRepresentative, RESULTS_POLICY, uploadClosesAt } from './results.policy';
import { ResultsRepository } from './results.repository';

/**
 * Итог `ensureAttempt`: попытка основной активности; `limit` — исчерпан предел попыток заявки; `late` — файл принят
 * сервером после срока загрузки (A5) — новой попытки нет.
 */
export type EnsuredAttempt =
  { attemptId: string; refused: null } | { attemptId: null; refused: 'limit' | 'late' };

/**
 * Приём попыток (race-results-03): автоматические — по событиям `tracks` и заявке (`results-intake`), общий шаг явной
 * попытки — `ensureAttempt`. Каждая заявка — своя транзакция под `lockEntry`; состояние группы дублей читается
 * **сейчас** (`ActivitySource.group`), порядок и повтор событий не важны.
 */
@Injectable()
export class AttemptIntake {
  private readonly logger = new Logger(AttemptIntake.name);

  constructor(
    private readonly repository: ResultsRepository,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(ROUTE_GEOMETRY) private readonly routes: RouteGeometry,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `tracks.activity-ready`: группа активности для каждой активной заявки пользователя. */
  async activityReady(activityId: string, userId: string): Promise<number> {
    const entries = await this.repository.activeEntriesOf(userId);
    for (const entry of entries) await this.syncGroup(entry._id, activityId);
    return entries.length;
  }

  /**
   * `tracks.activity-removed`: попытки удалённой активности → `withdrawn: activity_removed` (под замком каждой
   * заявки), лучший пересчитан; новая основная группы — `activityReady`.
   */
  async activityRemoved(
    activityId: string,
    userId: string,
    primaryActivityId: string | null,
  ): Promise<void> {
    for (const attempt of await this.repository.attemptsOfActivity(activityId)) {
      await this.transactions.run(async (tx) => {
        const entry = await this.repository.lockEntry(tx, attempt.entryId, this.clock.now());
        if (!entry) return;
        await this.repository.withdrawAttempt(
          tx,
          attempt._id,
          'activity_removed',
          this.clock.now(),
        );
        await this.repository.refreshEntry(tx, entry);
      });
    }
    if (primaryActivityId) await this.activityReady(primaryActivityId, userId);
  }

  /** `results.entry-created`: основные заезды райдера в окне гонки («проехал и забыл», Q3). */
  async entryCreated(entryId: string): Promise<number> {
    const entry = await this.repository.findEntryById(entryId);
    if (entry?.status !== 'active') return 0;
    const race = await this.races.get(entry.raceId);
    if (!race) return 0;
    const activities = await this.activities.listInRange(
      entry.userId,
      race.windowStartsAt,
      race.closesAt,
      RESULTS_POLICY.candidatesLimit,
    );
    for (const activity of activities) await this.syncGroup(entryId, activity.id);
    return activities.length;
  }

  /**
   * Группа дублей активности ↔ попытки заявки (одна транзакция под `lockEntry`): основная проходит предфильтр или к
   * группе относится запрос райдера → попытка есть/создаётся (снятая `not_primary` оживает новой ревизией); попытки
   * прочих членов — `withdrawn: not_primary`; запросы по загрузкам группы получают попытку; лучший пересчитан.
   */
  async syncGroup(entryId: string, activityId: string): Promise<void> {
    const snapshot = await this.repository.findEntryById(entryId);
    if (snapshot?.status !== 'active') return;
    // коридор и окно после первой заявки не меняются (V-12): гонка и рамка маршрута читаются до транзакции
    const race = await this.races.get(snapshot.raceId);
    if (race?.status !== 'published' || !race.corridor) return;
    // протокол опубликован — новых попыток нет (§7.4). Остаточная гонка (R4, RC-13): гонка прочитана до публикации —
    // попытка появится в заявке, но не в снимке (протокол читается только из снимка); публикация возможна лишь через
    // 24 ч после окна (A5), к этому моменту приём давно завершён
    if (race.protocolPublishedAt !== null) return;
    const routeBounds = await this.routes.bounds(race.corridor.routeId);
    let limited = false;
    await this.transactions.run(async (tx) => {
      limited = false;
      const now = this.clock.now();
      const entry = await this.repository.lockEntry(tx, entryId, now);
      if (entry?.status !== 'active') return;
      const group = await this.activities.group(activityId, tx);
      if (!group || group.userId !== entry.userId) return;
      const attempts = await this.repository.attemptsOfEntry(entry._id, tx);
      // для гонки группу представляет сильнейший (по приоритету основной) член, принятый до срока загрузки (A5):
      // поздний дубль не снимает засчитанный результат, не улучшает время и не лишает попытки своевременный файл,
      // даже если приём попыток отстал от очереди (снимает попытку только удаление заезда)
      const primary = raceRepresentative(group.members, race);
      const byUpload = new Map(group.members.map((member) => [member.uploadId, member]));
      for (const attempt of primary ? attempts : []) {
        const member = group.members.find((candidate) => candidate.id === attempt.activityId);
        // исключённую панелью приём не снимает и не оживляет (D-24)
        if (
          member &&
          member.id !== primary?.id &&
          attempt.status !== 'withdrawn' &&
          attempt.status !== 'excluded'
        ) {
          await this.repository.withdrawAttempt(tx, attempt._id, 'not_primary', now);
        }
      }
      const requested = entry.requests.some((request) => byUpload.has(request.uploadId));
      let attemptId: string | null = null;
      if (
        primary &&
        (requested || (routeBounds !== null && mayMatch(primary, race, routeBounds)))
      ) {
        const ensured = await this.ensureAttempt(tx, entry, race, primary, attempts, {
          origin: requested ? 'explicit' : 'auto',
          now,
        });
        limited = ensured.refused === 'limit';
        attemptId = ensured.attemptId;
      }
      const requests = entry.requests.map((request) => {
        const member = byUpload.get(request.uploadId);
        return member
          ? { ...request, activityId: member.id, attemptId: attemptId ?? request.attemptId }
          : request;
      });
      await this.repository.setRequests(tx, entry, requests);
      await this.repository.refreshEntry(tx, entry);
    });
    if (limited) {
      this.logger.warn(
        `entry ${entryId}: attempt limit ${RESULTS_POLICY.maxAttemptsPerEntry} reached, activity ${activityId} skipped`,
      );
    }
  }

  /**
   * Попытка основной активности в транзакции под `lockEntry` заявки: есть — явное намерение делает её явной, снятая
   * оживает новой ревизией; нет — новая `queued` и событие проверки (если не исчерпан предел попыток заявки). Файл
   * основной принят после срока загрузки (A5) — ни новой, ни ожившей попытки, для любого `origin`.
   */
  async ensureAttempt(
    tx: DbSession,
    entry: RaceEntryDoc,
    race: RaceForResults,
    activity: ActivityRef,
    attempts: readonly RaceAttemptDoc[],
    { origin, now }: { origin: AttemptOrigin; now: Date },
  ): Promise<EnsuredAttempt> {
    if (activity.uploadCreatedAt >= uploadClosesAt(race))
      return { attemptId: null, refused: 'late' };
    const existing = attempts.find((attempt) => attempt.activityId === activity.id);
    if (existing) {
      if (existing.status === 'withdrawn') {
        const revived = await this.repository.requeueAttempt(tx, existing._id, now, {
          statusIn: ['withdrawn'],
        });
        if (revived) await this.queueCheck(tx, revived);
      }
      if (origin === 'explicit' && existing.origin === 'auto') {
        await this.repository.markExplicit(tx, existing._id, now);
      }
      return { attemptId: existing._id, refused: null };
    }
    if (attempts.length >= RESULTS_POLICY.maxAttemptsPerEntry || !race.corridor) {
      return { attemptId: null, refused: 'limit' };
    }
    const attempt: RaceAttemptDoc = {
      _id: uuidv7(),
      raceId: race.id,
      entryId: entry._id,
      userId: entry.userId,
      activityId: activity.id,
      uploadId: activity.uploadId,
      activity: {
        startedAt: activity.startedAt,
        source: activity.source,
        elapsedSec: activity.elapsedSec,
        distanceM: activity.distanceM,
      },
      origin,
      status: 'queued',
      matched: null,
      reasons: [],
      failure: null,
      withdrawReason: null,
      segment: null,
      touchedCorridor: null,
      candidates: null,
      diagnostics: null,
      engineVersion: null,
      corridor: { routeId: race.corridor.routeId, widthM: race.corridor.widthM },
      checkRevision: 1,
      checkAttempts: 0,
      requeues: 0,
      checkJobId: null,
      createdAt: now,
      updatedAt: now,
      checkedAt: null,
    };
    await this.repository.insertAttempt(tx, attempt);
    await this.queueCheck(tx, attempt);
    return { attemptId: attempt._id, refused: null };
  }

  /** Событие проверки ревизии попытки — в той же транзакции; id события (jobId задачи) — в попытку. */
  async queueCheck(
    tx: DbSession,
    attempt: Pick<RaceAttemptDoc, '_id' | 'checkRevision'>,
  ): Promise<void> {
    const jobId = await this.outbox.append(tx, {
      type: RESULTS_ATTEMPT_CHECK_REQUESTED,
      payload: { attemptId: attempt._id, checkRevision: attempt.checkRevision },
    });
    await this.repository.setCheckJob(tx, attempt._id, jobId);
  }
}
