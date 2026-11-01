import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { QUEUE } from '../../queues';
import { ROUTE_RIDE_ROUTES, type RouteRideRoutes } from '../routes';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import { ROUTE_RIDE_ORPHANS_POLICY } from './route-rides.policy';
import { RouteRidesRepository } from './route-rides.repository';

export const ROUTE_RIDES_ORPHANS_JOB = 'orphans';

/** Разовая задача без дублей (jobId): прогон при старте worker — сироты до выката убираются сразу. */
const ONE_SHOT = { removeOnComplete: true, removeOnFail: true } as const;
export const ROUTE_RIDES_ORPHANS_BOOT_JOB_ID = 'route-rides.orphans.boot';
/** Курсор незаконченного скана (`_id` последнего просмотренного): прогон с пределом пачек продолжает с него. */
export const ROUTE_RIDES_ORPHANS_CURSOR_KEY = 'route-rides:orphans:cursor';
const CURSOR_TTL_SEC = 7 * 86_400;

/** Расписание регламента `route-rides`; upsert идемпотентен — несколько worker не плодят дубли. */
export const ROUTE_RIDES_SCHEDULES = [
  {
    id: 'route-rides.orphans.daily',
    repeat: { pattern: '23 4 * * *', tz: 'Europe/Minsk' },
    job: { name: ROUTE_RIDES_ORPHANS_JOB },
  },
] as const;

/** Итог прогона (метрики задачи BullMQ и лог): просмотрено, удалено по причине, пачек, остался ли хвост. */
export interface RouteRideOrphansResult {
  scanned: number;
  deletedActivity: number;
  deletedRoute: number;
  batches: number;
  more: boolean;
}

/**
 * Уборщик сирот `route-rides` (route-rides-08, RC-1 вариант (b) route-rides-01): заезды, у которых активность удалена
 * (`ActivitySource.liveActivityIds` — дубль группы жив, пока жива его активность, как на чтении) или маршрут удалён
 * насовсем (`RouteRideRoutes.existingIds`; снятый с публикации и скрытый маршрут существует — его заезды остаются,
 * повторная публикация возвращает историю). Основной путь удаления — событие `tracks.activity-removed` и транзакция
 * нового заезда; уборщик добирает пропущенное (POST после события, сироты до выката, удалённые маршруты райдеров).
 * Скан по `_id` пачками, не больше `maxBatches` за прогон — курсор в Redis после каждой полной пачки (хвост и сбой
 * посреди прогона продолжаются с него; потеря — скан с начала; конец скана — курсор снят); признак
 * сироты необратим — идемпотентен; лог — только счётчики, без id и ПДн.
 */
@Processor(QUEUE.routeRidesMaintenance)
export class RouteRidesMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(RouteRidesMaintenanceProcessor.name);

  constructor(
    private readonly repository: RouteRidesRepository,
    @Inject(ROUTE_RIDE_ROUTES) private readonly routes: RouteRideRoutes,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job): Promise<RouteRideOrphansResult> {
    if (job.name !== ROUTE_RIDES_ORPHANS_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.routeRidesMaintenance}`);
    }
    return this.sweep();
  }

  async sweep(): Promise<RouteRideOrphansResult> {
    const started = Date.now();
    const { batchSize, maxBatches } = ROUTE_RIDE_ORPHANS_POLICY;
    const result: RouteRideOrphansResult = {
      scanned: 0,
      deletedActivity: 0,
      deletedRoute: 0,
      batches: 0,
      more: false,
    };
    let after = await this.redis.get(ROUTE_RIDES_ORPHANS_CURSOR_KEY);
    for (;;) {
      if (result.batches >= maxBatches) {
        result.more = true;
        break;
      }
      const refs = await this.repository.scanRefs(after, batchSize);
      if (refs.length === 0) break;
      result.batches += 1;
      result.scanned += refs.length;
      after = refs[refs.length - 1]!._id;

      const live = await this.activities.liveActivityIds(refs.map((ref) => ref.activityId));
      const routes = await this.routes.existingIds(refs.map((ref) => ref.routeId));
      const noActivity = refs.filter((ref) => !live.has(ref.activityId));
      const noRoute = refs.filter((ref) => live.has(ref.activityId) && !routes.has(ref.routeId));
      result.deletedActivity += await this.repository.deleteRefs(noActivity);
      result.deletedRoute += await this.repository.deleteRefs(noRoute);
      if (refs.length < batchSize) break;
      // после каждой пачки: сбой посреди прогона (рестарт worker, ошибка Mongo) продолжит с неё, а не с начала
      await this.redis.set(ROUTE_RIDES_ORPHANS_CURSOR_KEY, after, 'EX', CURSOR_TTL_SEC);
    }
    if (!result.more) await this.redis.del(ROUTE_RIDES_ORPHANS_CURSOR_KEY);
    this.logger.log(
      `orphans: scanned ${result.scanned} in ${result.batches} batch(es), deleted ${result.deletedActivity}` +
        ` (activity) + ${result.deletedRoute} (route)${result.more ? ', more left' : ''}` +
        ` in ${Date.now() - started} ms`,
    );
    return result;
  }
}

@Injectable()
export class RouteRidesSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.routeRidesMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of ROUTE_RIDES_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
    await this.queue.add(
      ROUTE_RIDES_ORPHANS_JOB,
      {},
      { jobId: ROUTE_RIDES_ORPHANS_BOOT_JOB_ID, ...ONE_SHOT },
    );
  }
}
