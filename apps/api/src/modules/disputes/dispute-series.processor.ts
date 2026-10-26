import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { PanelDisputeSeriesData } from '@pokatim/contracts';
import type { DisputeSeries, SeriesWindow, TrackFormat } from '@pokatim/tracks/parse';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import type { Job } from 'bullmq';

import {
  DEFAULT_PARSE_LIMITS,
  type ParseLimits,
  runParseThread,
  type ThreadOutcome,
} from '../../parse-thread';
import { QUEUE } from '../../queues';
import { RESULTS_FOR_DISPUTES, type ResultsForDisputes } from '../results';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import {
  DISPUTE_SERIES_BUILD_JOB,
  DisputeSeriesCache,
  DisputeSeriesJob,
} from './dispute-series.cache';

export type DisputeSeriesOutcome = 'ready' | 'no_source' | 'failed' | 'skipped';

/**
 * Ряды пульса и мощности для разбора спора (`dispute-series`, race-results-06b): лучшая попытка цели всё ещё та же
 * (иначе — `skipped`) → исходник через `ActivitySource.readSource` → `analyzeSeries` в потоке разбора (семафор
 * `PARSE_THREADS_MAX`, 30 с, 160/32 МБ) → кэш Redis с TTL. Отказ файла или потока — видимое `unavailable: failed`;
 * сбой окружения — исключение и ретрай, на последней попытке — `failed`. Лог — id, ревизия, итог, число ячеек и время,
 * без значений рядов.
 */
@Processor(QUEUE.disputeSeries, { concurrency: 1 })
export class DisputeSeriesProcessor extends WorkerHost {
  private readonly logger = new Logger(DisputeSeriesProcessor.name);
  /** Лимиты потока разбора (тесты уменьшают таймаут). */
  parseLimits: ParseLimits = DEFAULT_PARSE_LIMITS;

  constructor(
    private readonly cache: DisputeSeriesCache,
    @Inject(RESULTS_FOR_DISPUTES) private readonly results: ResultsForDisputes,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<DisputeSeriesOutcome> {
    if (job.name !== DISPUTE_SERIES_BUILD_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.disputeSeries}`);
    }
    const data = DisputeSeriesJob.safeParse(job.data);
    if (!data.success) {
      this.logger.warn(`job ${job.id}: no valid data, skipped`);
      return 'skipped';
    }
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return this.build(data.data, { finalAttempt });
  }

  /** Ряды в потоке разбора (точка подмены в тестах сбоя потока). */
  analyze(
    bytes: Uint8Array,
    format: TrackFormat,
    window: SeriesWindow,
    now: Date,
  ): Promise<ThreadOutcome<DisputeSeries>> {
    return runParseThread<DisputeSeries>(
      'analyzeSeries',
      [bytes, format, window, now],
      this.parseLimits,
    );
  }

  /** Построение рядов одной (попытка, ревизия) — вызывается и тестами напрямую. */
  async build(
    job: DisputeSeriesJob,
    { finalAttempt = false }: { finalAttempt?: boolean } = {},
  ): Promise<DisputeSeriesOutcome> {
    const started = Date.now();
    const { attemptId, checkRevision } = job;
    const segment = await this.results.bestSegment(job.entryId);
    if (
      !segment ||
      segment.attemptId !== attemptId ||
      segment.checkRevision !== checkRevision ||
      (await this.cache.read(attemptId, checkRevision))?.kind === 'ready'
    ) {
      await this.cache.release(attemptId, checkRevision);
      this.logger.log(`attempt ${attemptId} rev ${checkRevision}: skipped`);
      return 'skipped';
    }
    let outcome: DisputeSeriesOutcome;
    let bins = 0;
    let code = '';
    try {
      const source = await this.activities.readSource(segment.activityId);
      if (!source) {
        outcome = 'no_source';
        await this.cache.storeFailed(attemptId, checkRevision, 'no_source');
      } else {
        const result = await this.analyze(
          source.bytes,
          source.format,
          { startedAt: segment.startedAt, finishedAt: segment.finishedAt },
          this.clock.now(),
        );
        if (result.ok) {
          outcome = 'ready';
          bins = result.result.distanceM.length;
          await this.cache.storeReady(attemptId, checkRevision, toContract(result.result));
        } else {
          outcome = 'failed';
          code = result.code;
          await this.cache.storeFailed(attemptId, checkRevision, 'failed');
        }
      }
    } catch (error) {
      // сбой окружения (загрузчик потока, хранилище не ENOENT, Redis) — ретрай; на последней попытке — видимый отказ
      if (!finalAttempt) throw error;
      outcome = 'failed';
      code = 'error';
      await this.cache.storeFailed(attemptId, checkRevision, 'failed');
    }
    this.logger.log(
      `attempt ${attemptId} rev ${checkRevision}: ${outcome}${code ? ` (${code})` : ''}` +
        ` bins ${bins} in ${Date.now() - started} ms`,
    );
    return outcome;
  }
}

/** Итог потока → контракт панели (явный список полей). */
const toContract = (series: DisputeSeries): PanelDisputeSeriesData => ({
  segmentDistanceM: series.segmentDistanceM,
  distanceM: series.distanceM,
  heartRate: series.heartRate,
  power: series.power,
  speedKmh: series.speedKmh,
  summary: series.summary,
});
