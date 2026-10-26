import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { AttemptFailure } from '@pokatim/contracts';
import type {
  AttemptAnalysis,
  CorridorGeometry,
  MatchWindow,
  TrackFormat,
} from '@pokatim/tracks/parse';
import { CLOCK, type Clock, type OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader, MongoTransactions } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import {
  DEFAULT_PARSE_LIMITS,
  type ParseLimits,
  runParseThread,
  type ThreadOutcome,
} from '../../parse-thread';
import { QUEUE } from '../../queues';
import { RACE_REGISTRY, type RaceRegistry } from '../races';
import { ROUTE_GEOMETRY, type RouteGeometry } from '../routes';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import type { RaceAttemptDoc } from './results.collection';
import { RESULTS_ATTEMPT_CHECK_REQUESTED, ResultsAttemptCheckRequested } from './results.events';
import { verdictFields } from './results.policy';
import { type CheckResult, ResultsRepository } from './results.repository';

export type AttemptCheckOutcome = 'counted' | 'rejected' | 'failed' | 'withdrawn' | 'skipped';

/** Коды потока, которые становятся провалом проверки без ретрая (повтор даст то же). */
const THREAD_FAILURES: readonly string[] = ['timeout', 'unreadable', 'corridor_invalid'];

/** Попытку за время проверки сняли или перепоставили — транзакция откатывается, ничего не пишет. */
class StaleRevision extends Error {}

const emptyResult = (now: Date): CheckResult => ({
  status: 'failed',
  matched: null,
  reasons: [],
  failure: null,
  withdrawReason: null,
  segment: null,
  touchedCorridor: null,
  candidates: null,
  diagnostics: null,
  engineVersion: null,
  trackMap: null,
  checkedAt: now,
});

const failed = (failure: AttemptFailure, now: Date): CheckResult => ({
  ...emptyResult(now),
  failure,
});

/**
 * Сверка попытки (`attempt-check`, jobId = id события outbox `results.attempt-check-requested`): захват своей
 * ревизии (`queued`/`checking`) → гонка, линия сверки, исходник и линия показа активности (разметка трека, maps-02)
 * через порты → `analyzeAttempt` в потоке разбора
 * (семафор, 30 с, 160/32 МБ) → транзакция { `lockEntry` → вердикт своей ревизией → лучший и сводка }. Сбой окружения
 * — исключение и ретрай BullMQ, на последней попытке — `failed: error` (виден в панели). Параллелизм — 1.
 */
@Processor(QUEUE.attemptCheck, { concurrency: 1 })
export class AttemptCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptCheckProcessor.name);
  /** Лимиты потока разбора (тест «долгая проверка» уменьшает таймаут). */
  parseLimits: ParseLimits = DEFAULT_PARSE_LIMITS;

  constructor(
    private readonly repository: ResultsRepository,
    private readonly outbox: MongoOutboxReader,
    private readonly transactions: MongoTransactions,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(ROUTE_GEOMETRY) private readonly routes: RouteGeometry,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<AttemptCheckOutcome> {
    if (job.name !== RESULTS_ATTEMPT_CHECK_REQUESTED) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.attemptCheck}`);
    }
    const payload = ResultsAttemptCheckRequested.safeParse(
      await this.outbox.payloadOf(job.data.outboxEventId),
    );
    if (!payload.success) {
      this.logger.warn(`event ${job.data.outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return this.check(payload.data.attemptId, payload.data.checkRevision, { finalAttempt });
  }

  /** Сверка в потоке разбора (точка подмены в тестах сбоя потока). */
  analyze(
    bytes: Uint8Array,
    format: TrackFormat,
    corridor: CorridorGeometry,
    window: MatchWindow,
    now: Date,
    line: [number, number][] | null = null,
  ): Promise<ThreadOutcome<AttemptAnalysis>> {
    return runParseThread<AttemptAnalysis>(
      'analyzeAttempt',
      [bytes, format, corridor, window, now, line],
      this.parseLimits,
    );
  }

  /** Проверка одной ревизии попытки (вызывается и тестами напрямую). */
  async check(
    attemptId: string,
    checkRevision: number,
    { finalAttempt = false }: { finalAttempt?: boolean } = {},
  ): Promise<AttemptCheckOutcome> {
    const started = Date.now();
    const attempt = await this.repository.claimAttempt(attemptId, checkRevision, this.clock.now());
    if (!attempt) return 'skipped';
    let result: CheckResult;
    try {
      result = await this.evaluate(attempt);
    } catch (error) {
      // сбой окружения (загрузчик потока, БД, хранилище не ENOENT) — ретрай; на последней попытке — видимый провал
      if (!finalAttempt) throw error;
      result = failed('error', this.clock.now());
    }
    const outcome = await this.record(attempt, result);
    this.logger.log(
      `attempt ${attempt._id} race ${attempt.raceId} rev ${checkRevision}: ${outcome}` +
        `${result.failure ? ` (${result.failure})` : ''}${result.reasons[0] ? ` (${result.reasons[0]})` : ''}` +
        ` in ${Date.now() - started} ms`,
    );
    return outcome;
  }

  private async evaluate(attempt: RaceAttemptDoc): Promise<CheckResult> {
    const race = await this.races.get(attempt.raceId);
    if (!race) throw new Error(`race ${attempt.raceId} is missing`);
    const geometry = await this.routes.matchGeometry(attempt.corridor.routeId);
    if (!geometry) {
      this.logger.warn(`race ${race.id} route ${attempt.corridor.routeId}: no match geometry`);
      return failed('corridor_invalid', this.clock.now());
    }
    const source = await this.activities.readSource(attempt.activityId);
    if (!source) {
      const now = this.clock.now();
      if (!(await this.activities.group(attempt.activityId))) {
        return { ...emptyResult(now), status: 'withdrawn', withdrawReason: 'activity_removed' };
      }
      return failed('storage', now);
    }
    // сохранённая линия показа — разметка трека считается по ней, не по пересчёту упрощения (§8.2 maps-02)
    const line = await this.activities.trackLine(attempt.userId, attempt.activityId);
    const now = this.clock.now();
    const outcome = await this.analyze(
      source.bytes,
      source.format,
      { ...geometry, widthM: attempt.corridor.widthM },
      { startsAt: race.windowStartsAt, closesAt: race.closesAt },
      now,
      line,
    );
    if (!outcome.ok) {
      if (outcome.code === 'implausible') {
        return {
          ...emptyResult(now),
          status: 'rejected',
          reasons: ['implausible'],
          matched: false,
        };
      }
      if (outcome.code === 'corridor_invalid') {
        this.logger.warn(`race ${race.id} route ${attempt.corridor.routeId}: corridor invalid`);
      }
      const failure = THREAD_FAILURES.includes(outcome.code)
        ? (outcome.code as AttemptFailure)
        : 'unreadable';
      return failed(failure, now);
    }
    const match = outcome.result;
    return {
      ...emptyResult(now),
      ...verdictFields(match),
      segment: match.segment,
      touchedCorridor: match.touchedCorridor,
      candidates: match.candidates,
      diagnostics: match.diagnostics,
      engineVersion: match.engineVersion,
      trackMap: match.trackMap,
    };
  }

  /** Итог своей ревизией под замком заявки; попытку сняли или перепоставили — ничего не пишем. */
  private async record(attempt: RaceAttemptDoc, result: CheckResult): Promise<AttemptCheckOutcome> {
    try {
      await this.transactions.run(async (tx) => {
        const now = this.clock.now();
        const entry = await this.repository.lockEntry(tx, attempt.entryId, now);
        if (!entry) throw new StaleRevision();
        if (
          !(await this.repository.recordCheck(tx, attempt._id, attempt.checkRevision, result, now))
        ) {
          throw new StaleRevision();
        }
        await this.repository.refreshEntry(tx, entry);
      });
    } catch (error) {
      if (error instanceof StaleRevision) return 'skipped';
      throw error;
    }
    // вердикт проверки — только counted|rejected|failed|withdrawn; прочие статусы сюда не приходят
    return result.status === 'queued' ||
      result.status === 'checking' ||
      result.status === 'excluded'
      ? 'skipped'
      : result.status;
  }
}
