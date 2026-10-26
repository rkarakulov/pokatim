import { Inject, Injectable } from '@nestjs/common';
import { ATTEMPT_STATUSES, type AttemptStatus } from '@pokatim/contracts';
import { MONGO_CLIENT, MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db, Filter, MongoClient } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type EntryRequest,
  type RaceAttemptDoc,
  type RaceAttemptReviewDoc,
  type RaceEntryDoc,
  type RaceProtocolRowDoc,
  type RaceRecalculationDoc,
  type ResultsCollections,
  resultsCollections,
} from './results.collection';
import {
  attemptHidden,
  EXCLUDABLE_STATUSES,
  pickBest,
  RESULTS_POLICY,
  summarize,
} from './results.policy';

/** Позиция строки таблицы в порядке `(best.elapsedSec, best.startedAt, _id)`. */
export interface RankPosition {
  elapsedSec: number;
  startedAt: Date;
  id: string;
}

/** Строка таблицы: активная заявка с засчитанным лучшим результатом. */
export type RankedEntry = Pick<RaceEntryDoc, '_id' | 'userId'> & {
  best: NonNullable<RaceEntryDoc['best']>;
};

export interface PanelCounts {
  entries: number;
  active: number;
  withdrawn: number;
  ranked: number;
  attempts: Record<AttemptStatus, number>;
  hidden: number;
  failed: number;
  staleEngine: number;
}

/** Поля вердикта (итог проверки) — пишет `recordCheck`. */
export type CheckResult = Pick<
  RaceAttemptDoc,
  | 'status'
  | 'matched'
  | 'reasons'
  | 'failure'
  | 'withdrawReason'
  | 'segment'
  | 'touchedCorridor'
  | 'candidates'
  | 'diagnostics'
  | 'engineVersion'
  | 'trackMap'
  | 'checkedAt'
>;

/** Незавершённые проверки гонки (RC-1) и финальные провалы. */
export interface PendingChecks {
  queued: number;
  checking: number;
  /** вердикты (`counted|rejected|failed`) старше последнего запуска перепроверки */
  stale: number;
  failed: number;
}

/** Вердикты, которые перепроверка ставит на новую проверку. */
const VERDICT_STATUSES = ['counted', 'rejected', 'failed'] as const;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Единственный писатель `race_entries` и `race_attempts` (`pokatim-db.md`, race-results-03):
 * - транзакция, меняющая попытки заявки, её запросы, лучший результат, сводку или статус, **первой** операцией
 *   вызывает `lockEntry` (`$inc version` документа заявки): «лучшая — минимум по попыткам заявки» и «запрос по
 *   загрузке получил попытку» — условия по другим документам; без замка — write skew;
 * - вердикт пишется только своей ревизией: `checkRevision` и статус `checking` в фильтре (поздний повтор — no-op);
 * - места — при чтении, обе выборки страницы в одной snapshot-сессии;
 * - значения фильтров — только примитивы после zod;
 * - протокол (race-results-05): `race_attempt_reviews`, `race_protocol_rows`, `race_recalculations` — только вставки
 *   (тест-сторож `results.repository.test.ts`); действия панели — под замком результатов гонки
 *   (`RaceRegistry.lockResults`) первой операцией, изменение попыток и заявки — ещё и под `lockEntry`.
 * После публикации протокола заявку ещё могут изменить остаточные гонки (RC-13): приём, прочитавший гонку до
 * публикации; явная попытка, взявшая `now` до срока загрузки; снятие по `activity-removed` (R6). Снимок протокола
 * они не меняют — протокол читается только из снимка (RC-5), новых замков не нужно.
 */
@Injectable()
export class ResultsRepository {
  private readonly c: ResultsCollections;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
  ) {
    this.c = resultsCollections(db);
  }

  // --- замок участника ---

  /** Замок заявки — первая операция транзакции; заявки нет — `null`. */
  lockEntry(session: DbSession, entryId: string, now: Date): Promise<RaceEntryDoc | null> {
    return this.c.entries.findOneAndUpdate(
      { _id: entryId },
      { $inc: { version: 1 }, $set: { updatedAt: now } },
      { session, returnDocument: 'after' },
    );
  }

  /** Замок своей заявки на гонку (поиск и запись — одна операция); заявки нет — `null`. */
  lockEntryOf(
    session: DbSession,
    raceId: string,
    userId: string,
    now: Date,
  ): Promise<RaceEntryDoc | null> {
    return this.c.entries.findOneAndUpdate(
      { raceId, userId },
      { $inc: { version: 1 }, $set: { updatedAt: now } },
      { session, returnDocument: 'after' },
    );
  }

  // --- заявки ---

  async findEntry(
    raceId: string,
    userId: string,
    session?: DbSession,
  ): Promise<RaceEntryDoc | undefined> {
    return (await this.c.entries.findOne({ raceId, userId }, { session })) ?? undefined;
  }

  async findEntryById(id: string, session?: DbSession): Promise<RaceEntryDoc | undefined> {
    return (await this.c.entries.findOne({ _id: id }, { session })) ?? undefined;
  }

  /** Вставка заявки (транзакция заявки после `admitEntry`); гонку двух вставок ловит уникальный индекс. */
  async insertEntry(session: DbSession, doc: RaceEntryDoc): Promise<void> {
    await this.c.entries.insertOne(doc, { session });
  }

  /** Отмена участия (под `lockEntry`): только активная. */
  async withdrawEntry(session: DbSession, id: string, now: Date): Promise<void> {
    await this.c.entries.updateOne(
      { _id: id, status: 'active' },
      { $set: { status: 'withdrawn', withdrawnAt: now, updatedAt: now } },
      { session },
    );
  }

  /** Активные заявки пользователя (индекс `(userId, status)`, единицы). */
  activeEntriesOf(userId: string): Promise<RaceEntryDoc[]> {
    return this.c.entries.find({ userId, status: 'active' }).toArray();
  }

  /** Запросы заявки целиком (под `lockEntry`); без изменений — без записи. */
  async setRequests(
    session: DbSession,
    entry: Pick<RaceEntryDoc, '_id' | 'requests'>,
    requests: EntryRequest[],
  ): Promise<void> {
    if (sameJson(entry.requests, requests)) return;
    await this.c.entries.updateOne({ _id: entry._id }, { $set: { requests } }, { session });
  }

  /**
   * Лучший результат и сводка заявки по её попыткам (≤ 30) — под `lockEntry` в той же транзакции; без изменений —
   * без записи.
   */
  async refreshEntry(
    session: DbSession,
    entry: Pick<RaceEntryDoc, '_id' | 'best' | 'summary'>,
  ): Promise<void> {
    const attempts = await this.attemptsOfEntry(entry._id, session);
    const best = pickBest(attempts);
    const summary = summarize(attempts);
    if (sameJson(entry.best, best) && sameJson(entry.summary, summary)) return;
    await this.c.entries.updateOne({ _id: entry._id }, { $set: { best, summary } }, { session });
  }

  // --- попытки ---

  /** Попытки заявки, новые сверху (индекс `race_attempts_entry_idx`). */
  attemptsOfEntry(entryId: string, session?: DbSession): Promise<RaceAttemptDoc[]> {
    return this.c.attempts.find({ entryId }, { session }).sort({ _id: -1 }).toArray();
  }

  async findAttempt(id: string, session?: DbSession): Promise<RaceAttemptDoc | undefined> {
    return (await this.c.attempts.findOne({ _id: id }, { session })) ?? undefined;
  }

  /** Попытки активности во всех гонках (снятие при удалении заезда). */
  attemptsOfActivity(activityId: string): Promise<RaceAttemptDoc[]> {
    return this.c.attempts.find({ activityId }).toArray();
  }

  /** Попытки гонки, кроме снятых (перепроверка). */
  liveAttemptsOfRace(raceId: string): Promise<Pick<RaceAttemptDoc, '_id' | 'entryId'>[]> {
    return this.c.attempts
      .find(
        { raceId, status: { $ne: 'withdrawn' } },
        { projection: { _id: 1, entryId: 1 }, sort: { _id: 1 } },
      )
      .toArray();
  }

  async insertAttempt(session: DbSession, doc: RaceAttemptDoc): Promise<void> {
    await this.c.attempts.insertOne(doc, { session });
  }

  /** Задача проверки последней постановки (под `lockEntry`, вместе с событием outbox). */
  async setCheckJob(session: DbSession, id: string, checkJobId: string): Promise<void> {
    await this.c.attempts.updateOne({ _id: id }, { $set: { checkJobId } }, { session });
  }

  /** Явное намерение: автоматическая попытка становится явной (видимость отказа без перепроверки). */
  async markExplicit(session: DbSession, id: string, now: Date): Promise<void> {
    await this.c.attempts.updateOne(
      { _id: id, origin: 'auto' },
      { $set: { origin: 'explicit', updatedAt: now } },
      { session },
    );
  }

  /**
   * Новая ревизия проверки (под `lockEntry`): `queued`, итог прежней ревизии стирается; `requeue` — повторная
   * постановка зависшей. `null` — попытка не в ожидаемом состоянии.
   */
  requeueAttempt(
    session: DbSession,
    id: string,
    now: Date,
    options: { statusIn?: readonly AttemptStatus[]; requeue?: boolean } = {},
  ): Promise<RaceAttemptDoc | null> {
    const filter: Filter<RaceAttemptDoc> = { _id: id };
    if (options.statusIn) filter.status = { $in: [...options.statusIn] };
    return this.c.attempts.findOneAndUpdate(
      filter,
      {
        $set: {
          status: 'queued',
          matched: null,
          reasons: [],
          failure: null,
          withdrawReason: null,
          segment: null,
          touchedCorridor: null,
          candidates: null,
          diagnostics: null,
          trackMap: null,
          checkedAt: null,
          updatedAt: now,
        },
        $inc: { checkRevision: 1, ...(options.requeue ? { requeues: 1 } : {}) },
      },
      { session, returnDocument: 'after' },
    );
  }

  /**
   * Снятие попытки (под `lockEntry`): активность удалена (и исключённую) или перестала быть основной (исключённую
   * панелью — нет: приём её не снимает и не оживляет, race-results-05).
   */
  async withdrawAttempt(
    session: DbSession,
    id: string,
    reason: NonNullable<RaceAttemptDoc['withdrawReason']>,
    now: Date,
  ): Promise<void> {
    await this.c.attempts.updateOne(
      {
        _id: id,
        status:
          reason === 'not_primary' ? { $nin: ['withdrawn', 'excluded'] } : { $ne: 'withdrawn' },
      },
      { $set: { status: 'withdrawn', withdrawReason: reason, updatedAt: now } },
      { session },
    );
  }

  /**
   * Захват проверки (вне транзакции, один документ): своя ревизия в `queued`/`checking`; иначе — `null` (другая
   * ревизия, итог записан, попытка снята).
   */
  claimAttempt(id: string, checkRevision: number, now: Date): Promise<RaceAttemptDoc | null> {
    return this.c.attempts.findOneAndUpdate(
      { _id: id, checkRevision, status: { $in: ['queued', 'checking'] } },
      { $set: { status: 'checking', updatedAt: now }, $inc: { checkAttempts: 1 } },
      { returnDocument: 'after' },
    );
  }

  /** Итог проверки своей ревизией (под `lockEntry`); `false` — попытку сняли или перепоставили. */
  async recordCheck(
    session: DbSession,
    id: string,
    checkRevision: number,
    result: CheckResult,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.c.attempts.updateOne(
      { _id: id, checkRevision, status: 'checking' },
      { $set: { ...result, updatedAt: now } },
      { session },
    );
    return updated.matchedCount === 1;
  }

  /** Финальный провал своей ревизии в ожидании или проверке (регламент зависших) — под `lockEntry`. */
  async failAttempt(
    session: DbSession,
    id: string,
    checkRevision: number,
    failure: NonNullable<RaceAttemptDoc['failure']>,
    now: Date,
  ): Promise<void> {
    await this.c.attempts.updateOne(
      { _id: id, checkRevision, status: { $in: ['queued', 'checking'] } },
      { $set: { status: 'failed', failure, checkedAt: now, updatedAt: now } },
      { session },
    );
  }

  /**
   * Зависшие проверки: `checking` с `checkingBefore`, `queued` с `queuedBefore` (индекс `race_attempts_stuck_idx`),
   * по `(updatedAt, _id)` после позиции `after`.
   */
  stuckAttempts(
    checkingBefore: Date,
    queuedBefore: Date,
    after: { updatedAt: Date; id: string } | null,
    limit: number,
  ): Promise<RaceAttemptDoc[]> {
    const and: Filter<RaceAttemptDoc>[] = [
      {
        $or: [
          { status: 'checking', updatedAt: { $lt: checkingBefore } },
          { status: 'queued', updatedAt: { $lt: queuedBefore } },
        ],
      },
    ];
    // продолжение обхода после пропущенных (живые задачи): самые давние — первыми
    if (after) {
      and.push({
        $or: [
          { updatedAt: { $gt: after.updatedAt } },
          { updatedAt: after.updatedAt, _id: { $gt: after.id } },
        ],
      });
    }
    return this.c.attempts
      .find({ $and: and })
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit)
      .toArray();
  }

  // --- таблица (места при чтении) ---

  /** Чтения таблицы в одной snapshot-сессии: страница и счётчики согласованы. */
  async withSnapshot<T>(fn: (session: DbSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession({ snapshot: true });
    try {
      return await fn(session);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Строки таблицы: активные заявки группы с лучшим результатом, без DQ по спору до публикации (race-results-06; после
   * публикации таблица читается из снимка). `disqualified: null` совпадает и с отсутствующим полем (заявки до `0018`);
   * частичный `race_entries_ranking_idx` остаётся пригодным — условие остаточное, DQ единичны.
   */
  private rankedFilter(raceId: string): Filter<RaceEntryDoc> {
    return { ...this.countedFilter(raceId), disqualified: null };
  }

  /** Активные заявки группы с лучшим результатом — с DQ по спору и без (база протокола). */
  private countedFilter(raceId: string): Filter<RaceEntryDoc> {
    return {
      raceId,
      groupKey: RESULTS_POLICY.groupKey,
      status: 'active',
      best: { $type: 'object' },
    };
  }

  /** Позиция строки таблицы гонки (курсор): не строка этой гонки — `null`. */
  async rankedPosition(
    raceId: string,
    entryId: string,
    session?: DbSession,
  ): Promise<RankPosition | null> {
    const doc = await this.c.entries.findOne(
      { ...this.rankedFilter(raceId), _id: entryId },
      { session, projection: { best: 1 } },
    );
    return doc?.best
      ? { elapsedSec: doc.best.elapsedSec, startedAt: doc.best.startedAt, id: doc._id }
      : null;
  }

  /** Строки группы (индекс `race_entries_ranking_idx`). */
  countRanked(raceId: string, session?: DbSession): Promise<number> {
    return this.c.entries.countDocuments(this.rankedFilter(raceId), { session });
  }

  countRankedLess(raceId: string, elapsedSec: number, session?: DbSession): Promise<number> {
    return this.c.entries.countDocuments(
      { ...this.rankedFilter(raceId), 'best.elapsedSec': { $lt: elapsedSec } },
      { session },
    );
  }

  countRankedEqual(raceId: string, elapsedSec: number, session?: DbSession): Promise<number> {
    return this.c.entries.countDocuments(
      { ...this.rankedFilter(raceId), 'best.elapsedSec': elapsedSec },
      { session },
    );
  }

  /** Строк до позиции включительно (курсор) — индекс первой строки следующей страницы. */
  countRankedUpTo(raceId: string, at: RankPosition, session?: DbSession): Promise<number> {
    return this.c.entries.countDocuments(
      {
        ...this.rankedFilter(raceId),
        $or: [
          { 'best.elapsedSec': { $lt: at.elapsedSec } },
          { 'best.elapsedSec': at.elapsedSec, 'best.startedAt': { $lt: at.startedAt } },
          {
            'best.elapsedSec': at.elapsedSec,
            'best.startedAt': at.startedAt,
            _id: { $lte: at.id },
          },
        ],
      },
      { session },
    );
  }

  /** Страница таблицы после позиции курсора. */
  async rankedPage(
    raceId: string,
    after: RankPosition | null,
    limit: number,
    session?: DbSession,
  ): Promise<RankedEntry[]> {
    const filter: Filter<RaceEntryDoc> = this.rankedFilter(raceId);
    if (after) {
      filter.$or = [
        { 'best.elapsedSec': { $gt: after.elapsedSec } },
        { 'best.elapsedSec': after.elapsedSec, 'best.startedAt': { $gt: after.startedAt } },
        {
          'best.elapsedSec': after.elapsedSec,
          'best.startedAt': after.startedAt,
          _id: { $gt: after.id },
        },
      ];
    }
    const docs = await this.c.entries
      .find(filter, { session, projection: { _id: 1, userId: 1, best: 1 } })
      .sort({ 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 })
      .limit(limit)
      .toArray();
    return docs.flatMap(({ _id, userId, best }) => (best ? [{ _id, userId, best }] : []));
  }

  /** Активные заявки гонки (индекс `race_entries_race_idx`). */
  countActiveEntries(raceId: string, session?: DbSession): Promise<number> {
    return this.c.entries.countDocuments({ raceId, status: 'active' }, { session });
  }

  // --- панель ---

  /** Сводка панели: заявки по статусам, строки, попытки по статусам, скрытые, провалы, версия движка. */
  async panelCounts(raceId: string, engineVersion: number): Promise<PanelCounts> {
    const [entries, ranked, attempts] = await Promise.all([
      this.c.entries
        .aggregate<{ _id: string; count: number }>([
          { $match: { raceId } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
        .toArray(),
      this.countRanked(raceId),
      this.c.attempts
        .find(
          { raceId },
          {
            projection: { origin: 1, status: 1, matched: 1, reasons: 1, engineVersion: 1 },
          },
        )
        .toArray(),
    ]);
    const byStatus = Object.fromEntries(ATTEMPT_STATUSES.map((status) => [status, 0])) as Record<
      AttemptStatus,
      number
    >;
    let hidden = 0;
    let staleEngine = 0;
    for (const attempt of attempts) {
      byStatus[attempt.status] += 1;
      if (attemptHidden(attempt)) hidden += 1;
      if (
        (attempt.status === 'counted' || attempt.status === 'rejected') &&
        attempt.engineVersion !== null &&
        attempt.engineVersion !== engineVersion
      ) {
        staleEngine += 1;
      }
    }
    const count = (status: string) => entries.find((row) => row._id === status)?.count ?? 0;
    return {
      entries: count('active') + count('withdrawn'),
      active: count('active'),
      withdrawn: count('withdrawn'),
      ranked,
      attempts: byStatus,
      hidden,
      failed: byStatus.failed,
      staleEngine,
    };
  }

  /** Попытки гонки в панели, новые сверху (индекс `race_attempts_race_status_idx`). */
  panelAttempts(
    raceId: string,
    status: AttemptStatus | undefined,
    afterId: string | null,
    limit: number,
  ): Promise<RaceAttemptDoc[]> {
    const filter: Filter<RaceAttemptDoc> = { raceId };
    if (status) filter.status = status;
    if (afterId) filter._id = { $lt: afterId };
    return this.c.attempts.find(filter).sort({ _id: -1 }).limit(limit).toArray();
  }

  // --- протокол (race-results-05; все записи — под замком результатов гонки) ---

  /**
   * Исключение трека (под `lockEntry`, D-24): попытка этой гонки в `EXCLUDABLE_STATUSES` → `excluded`. Вердикт прежней
   * ревизии остаётся в попытке (история), `checkRevision` не меняется: поздний вердикт — no-op (фильтр `checking`).
   * `null` — попытки нет в гонке или статус не подходит.
   */
  excludeAttempt(
    session: DbSession,
    raceId: string,
    attemptId: string,
    now: Date,
  ): Promise<RaceAttemptDoc | null> {
    return this.c.attempts.findOneAndUpdate(
      { _id: attemptId, raceId, status: { $in: [...EXCLUDABLE_STATUSES] } },
      { $set: { status: 'excluded', updatedAt: now } },
      { session, returnDocument: 'after' },
    );
  }

  /** Запись исключения или возврата — только вставка. */
  async insertReview(session: DbSession, doc: RaceAttemptReviewDoc): Promise<void> {
    await this.c.reviews.insertOne(doc, { session });
  }

  /** Последняя запись исключения/возврата попыток страницы (индекс `(attemptId, _id)`, одна выборка). */
  async latestReviews(attemptIds: readonly string[]): Promise<Map<string, RaceAttemptReviewDoc>> {
    if (attemptIds.length === 0) return new Map();
    const docs = await this.c.reviews
      .find({ attemptId: { $in: [...attemptIds] } })
      .sort({ attemptId: 1, _id: -1 })
      .toArray();
    const latest = new Map<string, RaceAttemptReviewDoc>();
    for (const doc of docs) if (!latest.has(doc.attemptId)) latest.set(doc.attemptId, doc);
    return latest;
  }

  /** Райдеры активных заявок гонки (строка чек-листа «необработанные треки»). */
  async activeEntryUserIds(raceId: string, session?: DbSession): Promise<string[]> {
    const docs = await this.c.entries
      .find({ raceId, status: 'active' }, { session, projection: { userId: 1 } })
      .toArray();
    return docs.map((doc) => doc.userId);
  }

  /**
   * Незавершённые проверки гонки (RC-1): `queued`, `checking` и вердикты старше `staleBefore` (последний запуск
   * перепроверки; `null` — не запускалась), плюс финальные провалы `failed`. Одна выборка.
   */
  async pendingChecks(
    raceId: string,
    staleBefore: Date | null,
    session?: DbSession,
  ): Promise<PendingChecks> {
    const is = (status: string) => ({ $cond: [{ $eq: ['$status', status] }, 1, 0] });
    const stale = staleBefore
      ? {
          $cond: [
            {
              $and: [
                { $in: ['$status', [...VERDICT_STATUSES]] },
                { $ne: ['$checkedAt', null] },
                { $lt: ['$checkedAt', staleBefore] },
              ],
            },
            1,
            0,
          ],
        }
      : 0;
    const [row] = await this.c.attempts
      .aggregate<PendingChecks>(
        [
          { $match: { raceId, status: { $in: ['queued', 'checking', ...VERDICT_STATUSES] } } },
          {
            $group: {
              _id: null,
              queued: { $sum: is('queued') },
              checking: { $sum: is('checking') },
              stale: { $sum: stale },
              failed: { $sum: is('failed') },
            },
          },
          { $project: { _id: 0, queued: 1, checking: 1, stale: 1, failed: 1 } },
        ],
        { session },
      )
      .toArray();
    return row ?? { queued: 0, checking: 0, stale: 0, failed: 0 };
  }

  /** Попытки с вердиктом старше запроса перепроверки (worker перепоставляет их по одной под `lockEntry`). */
  staleVerdictAttempts(
    raceId: string,
    before: Date,
  ): Promise<Pick<RaceAttemptDoc, '_id' | 'entryId'>[]> {
    return this.c.attempts
      .find(
        { raceId, status: { $in: [...VERDICT_STATUSES] }, checkedAt: { $lt: before } },
        { projection: { _id: 1, entryId: 1 }, sort: { _id: 1 } },
      )
      .toArray();
  }

  /** Все строки таблицы гонки по порядку `(best.elapsedSec, best.startedAt, _id)` — база протокола. */
  async rankedEntries(raceId: string, session: DbSession): Promise<RankedEntry[]> {
    const docs = await this.c.entries
      .find(this.rankedFilter(raceId), { session, projection: { _id: 1, userId: 1, best: 1 } })
      .sort({ 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 })
      .toArray();
    return docs.flatMap(({ _id, userId, best }) => (best ? [{ _id, userId, best }] : []));
  }

  /**
   * База протокола (race-results-06, RC-2): активные заявки группы с лучшим результатом, **включая** DQ по спору, по
   * порядку `(best.elapsedSec, best.startedAt, _id)`. Признак DQ — из журнала (`disqualifiedEntries`).
   */
  async protocolBaseEntries(raceId: string, session: DbSession): Promise<RankedEntry[]> {
    const docs = await this.c.entries
      .find(this.countedFilter(raceId), { session, projection: { _id: 1, userId: 1, best: 1 } })
      .sort({ 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 })
      .toArray();
    return docs.flatMap(({ _id, userId, best }) => (best ? [{ _id, userId, best }] : []));
  }

  /**
   * DQ по спору до публикации (D-43, под `lockEntry` заявки в транзакции решения): только активная заявка гонки без
   * DQ; `false` — уже DQ или не активна (идемпотентно, без второй записи журнала).
   */
  async disqualifyEntry(
    session: DbSession,
    raceId: string,
    entryId: string,
    mark: { at: Date; disputeId: string },
  ): Promise<boolean> {
    const updated = await this.c.entries.updateOne(
      { _id: entryId, raceId, status: 'active', disqualified: null },
      { $set: { disqualified: mark, updatedAt: mark.at }, $inc: { version: 1 } },
      { session },
    );
    return updated.modifiedCount === 1;
  }

  /** Заявки по id (строки с местами в «Участниках» панели). */
  entriesByIds(ids: readonly string[], session: DbSession): Promise<RaceEntryDoc[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.c.entries
      .find({ _id: { $in: [...ids] } }, { session, projection: { requests: 0 } })
      .toArray();
  }

  /** Заявки гонки для «Участников» панели — по времени заявки, не больше `limit`. */
  entriesForStandings(raceId: string, limit: number, session: DbSession): Promise<RaceEntryDoc[]> {
    return this.c.entries
      .find({ raceId }, { session, projection: { requests: 0 } })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .toArray();
  }

  /** Ревизия протокола целиком — только вставка (пустой протокол — без записи строк). */
  async insertProtocolRows(session: DbSession, rows: RaceProtocolRowDoc[]): Promise<void> {
    if (rows.length === 0) return;
    await this.c.protocolRows.insertMany(rows, { session });
  }

  /** Строки ревизии по порядку протокола. */
  protocolRows(
    raceId: string,
    revision: number,
    session?: DbSession,
  ): Promise<RaceProtocolRowDoc[]> {
    return this.c.protocolRows.find({ raceId, revision }, { session }).sort({ order: 1 }).toArray();
  }

  async protocolRow(
    raceId: string,
    revision: number,
    entryId: string,
    session?: DbSession,
  ): Promise<RaceProtocolRowDoc | undefined> {
    return (
      (await this.c.protocolRows.findOne({ raceId, revision, entryId }, { session })) ?? undefined
    );
  }

  /** Публичная страница протокола: строки без DQ после позиции `afterOrder`. */
  protocolRowsPage(
    raceId: string,
    revision: number,
    afterOrder: number | null,
    limit: number,
    session: DbSession,
  ): Promise<RaceProtocolRowDoc[]> {
    const filter: Filter<RaceProtocolRowDoc> = { raceId, revision, status: { $ne: 'dq' } };
    if (afterOrder !== null) filter.order = { $gt: afterOrder };
    return this.c.protocolRows.find(filter, { session }).sort({ order: 1 }).limit(limit).toArray();
  }

  async countProtocolRows(
    raceId: string,
    revision: number,
    session?: DbSession,
  ): Promise<{ ranked: number; disqualified: number }> {
    const [total, disqualified] = [
      await this.c.protocolRows.countDocuments({ raceId, revision }, { session }),
      await this.c.protocolRows.countDocuments({ raceId, revision, status: 'dq' }, { session }),
    ];
    return { ranked: total - disqualified, disqualified };
  }

  /** Запись журнала пересчётов — только вставка; ревизию держит уникальный `(raceId, revision)`. */
  async insertRecalculation(session: DbSession, doc: RaceRecalculationDoc): Promise<void> {
    await this.c.recalculations.insertOne(doc, { session });
  }

  /**
   * Текущая ревизия протокола — максимальная ревизия журнала пересчётов гонки (RC-2); нет — `null`. Записей на гонку
   * единицы (индекс `(raceId, _id)`).
   */
  async currentRevision(raceId: string, session?: DbSession): Promise<number | null> {
    const doc = await this.c.recalculations.findOne(
      { raceId, revision: { $ne: null } },
      { session, sort: { revision: -1 }, projection: { revision: 1 } },
    );
    return doc?.revision ?? null;
  }

  /** Моменты последнего запуска и последнего применения перепроверки гонки. */
  async lastRecheck(
    raceId: string,
    session?: DbSession,
  ): Promise<{ startedAt: Date | null; appliedAt: Date | null }> {
    const last = async (kind: RaceRecalculationDoc['kind']) =>
      (
        await this.c.recalculations.findOne(
          { raceId, kind },
          { session, sort: { at: -1, _id: -1 }, projection: { at: 1 } },
        )
      )?.at ?? null;
    const startedAt = await last('recheck_started');
    const appliedAt = await last('recheck_applied');
    return { startedAt, appliedAt };
  }

  /**
   * Действующие DQ гонки — по журналу пересчётов (последнее решение `disqualified`/`disqualification_revoked` по
   * участнику в порядке ревизий), а не по строкам ревизии: участник с DQ мог выпасть из протокола без лучшего
   * результата и вернуться при следующей перепроверке — DQ снимает только явная отмена (D-28). Записи DQ по спору до
   * публикации (race-results-06) — `revision: null`, в порядке сортировки идут первыми.
   */
  async disqualifiedEntries(raceId: string, session?: DbSession): Promise<Set<string>> {
    const docs = await this.c.recalculations
      .find(
        { raceId, kind: { $in: ['disqualified', 'disqualification_revoked'] } },
        { session, projection: { kind: 1, entryId: 1, revision: 1 } },
      )
      .sort({ revision: 1, at: 1, _id: 1 })
      .toArray();
    const active = new Set<string>();
    for (const doc of docs) {
      if (!doc.entryId) continue;
      if (doc.kind === 'disqualified') active.add(doc.entryId);
      else active.delete(doc.entryId);
    }
    return active;
  }

  /** История пересчётов гонки — новые сверху. */
  listRecalculations(raceId: string, limit: number): Promise<RaceRecalculationDoc[]> {
    return this.c.recalculations.find({ raceId }).sort({ at: -1, _id: -1 }).limit(limit).toArray();
  }
}
