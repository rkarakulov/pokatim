import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { MY_ROUTE_MAX_COUNT } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import { ROUTE_RIDE_ROUTES, type RouteRideRoutes } from '../routes';
import {
  ACTIVITY_SOURCE,
  type ActivityRef,
  type ActivitySource,
  TRACK_ACTIVITY_GROUP_CREATED,
  TrackActivityGroupCreated,
} from '../tracks';
import { RouteRideEvaluator } from './route-ride-evaluator';
import { RouteRideAutoJobData } from './route-rides.events';
import {
  autoEligible,
  autoPlan,
  findExisting,
  nearRoutes,
  newRideDoc,
  primaryOfGroup,
  ROUTE_RIDE_AUTO_POLICY,
  ROUTE_RIDE_POLICY,
} from './route-rides.policy';
import type { RouteRideResult } from './route-rides.collection';
import { RouteRidesRepository } from './route-rides.repository';

/** Итог задачи: `skipped` — активность не годится или пропала; иначе — число прогонов движка и созданных заездов. */
export type RouteRideAutoOutcome = 'skipped' | { planned: number; passed: number };

/** Предел `ActivitySource.liveActivities` за вызов. */
const LIVE_BATCH = 200;

/**
 * Автопроверка новой активности по маршрутам (route-rides-03, V1–V5; `route-ride-auto`, jobId = id события outbox
 * `tracks.activity-group-created`): основная группы сейчас → годность (`autoEligible`) → план (`autoPlan`: маршруты со
 * своими заездами, затем свои готовые; видимость и рамка — порт `RouteRideRoutes.rideableBounds`, ≤ 20) → по маршруту
 * сверка `RouteRideEvaluator` (та же, что у ручной) → только `passed`: повторная проверка «заезд группы есть / квота /
 * активность жива» → готовый заезд `origin: 'auto'` одной записью (`insertChecked`, дубль ключа — пропуск). Не
 * пройден и провал проверки — ничего. Сбой окружения — исключение и ретрай всей задачи (сохранённые `passed`
 * пропускаются по V4); на последней попытке маршрут тихо пропускается. Лимит `route-rides-user` не тратится.
 */
@Processor(QUEUE.routeRideAuto, { concurrency: 1 })
export class RouteRideAutoProcessor extends WorkerHost {
  private readonly logger = new Logger(RouteRideAutoProcessor.name);

  constructor(
    private readonly repository: RouteRidesRepository,
    private readonly outbox: MongoOutboxReader,
    private readonly evaluator: RouteRideEvaluator,
    @Inject(ROUTE_RIDE_ROUTES) private readonly routes: RouteRideRoutes,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job<RouteRideAutoJobData>): Promise<RouteRideAutoOutcome> {
    if (job.name !== TRACK_ACTIVITY_GROUP_CREATED) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.routeRideAuto}`);
    }
    const data = RouteRideAutoJobData.parse(job.data);
    const payload = TrackActivityGroupCreated.safeParse(
      await this.outbox.payloadOf(data.outboxEventId),
    );
    if (!payload.success) {
      this.logger.warn(`event ${data.outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return this.run(payload.data.activityId, payload.data.userId, {
      finalAttempt,
      plan: data.plan,
      // план — в данные задачи до сверок: ретрай проверяет тот же набор (ревью pass 2)
      savePlan: (plan) => job.updateData({ ...data, plan }),
    });
  }

  /** Автопроверка одной активности (вызывается и тестами напрямую). */
  async run(
    activityId: string,
    userId: string,
    options: {
      finalAttempt?: boolean;
      /** план первой попытки (ретрай задачи) */
      plan?: readonly string[];
      savePlan?: (plan: string[]) => Promise<void>;
    } = {},
  ): Promise<RouteRideAutoOutcome> {
    const started = Date.now();
    const activity = await this.activities.activity(userId, activityId);
    const primary = activity ? await primaryOfGroup(this.activities, userId, activity) : null;
    if (!primary || !autoEligible(primary)) return 'skipped';

    let planned = options.plan ? [...options.plan] : null;
    if (!planned) {
      planned = await this.plan(userId, primary);
      await options.savePlan?.(planned);
    }
    let passed = 0;
    for (const routeId of planned) {
      if (await this.checkRoute(userId, routeId, primary, options.finalAttempt ?? false)) {
        passed += 1;
      }
    }
    this.logger.log(
      `route-ride-auto activity ${primary.id} user ${userId}: planned ${planned.length}, passed ${passed},` +
        ` skipped ${planned.length - passed} in ${Date.now() - started} ms`,
    );
    return { planned: planned.length, passed };
  }

  /**
   * План события (V2, V4, 8.1 AC-4): маршруты с автозаездом группы резервируют слоты первыми; остальные — пропуски,
   * видимость и рамка до отсечения 20. Заезды группы исключены из скана истории — повтор события получает тот же план.
   */
  private async plan(userId: string, primary: ActivityRef): Promise<string[]> {
    const group = await this.activities.group(primary.id);
    const members = group?.userId === userId ? group.members.map((member) => member.id) : [];
    const memberIds = members.includes(primary.id) ? members : [...members, primary.id];
    const ridden = await this.repository.ridesByRoute(
      userId,
      ROUTE_RIDE_AUTO_POLICY.riddenRoutesScan,
      memberIds,
    );
    const heads = await this.liveHeads(
      userId,
      ridden.flatMap((route) => route.rides.map((ride) => ride.activityId)),
    );
    const own = await this.routes.ownReadyIds(userId, MY_ROUTE_MAX_COUNT);
    const groupRides = await this.repository.groupRides(userId, memberIds);
    const { done, candidates } = autoPlan({ heads, ridden, own, group: groupRides });
    const { boundsBatch, maxRoutes } = ROUTE_RIDE_AUTO_POLICY;
    const picked = done.slice(0, maxRoutes);
    for (let i = 0; i < candidates.length && picked.length < maxRoutes; i += boundsBatch) {
      const batch = candidates.slice(i, i + boundsBatch);
      const bounds = await this.routes.rideableBounds(batch, userId);
      picked.push(...nearRoutes(batch, bounds, primary.bounds, maxRoutes - picked.length));
    }
    return picked;
  }

  /** Сверка по маршруту; `true` — создан заезд `passed`. */
  private async checkRoute(
    userId: string,
    routeId: string,
    primary: ActivityRef,
    finalAttempt: boolean,
  ): Promise<boolean> {
    // заезд группы уже есть (автозаезд прошлой попытки, ручной POST) — слот занят, прогона нет
    if (await this.groupRideExists(userId, routeId, primary.id)) return false;
    const draft = newRideDoc({
      userId,
      routeId,
      activity: primary,
      origin: 'auto',
      now: this.clock.now(),
    });
    let result: RouteRideResult;
    try {
      result = await this.evaluator.evaluate(draft);
    } catch (error) {
      // сбой окружения — ретрай всей задачи; на последней попытке — тихий пропуск маршрута
      if (!finalAttempt) throw error;
      this.logger.warn(
        `route-ride-auto activity ${primary.id} route ${routeId}: error skipped` +
          ` (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return false;
    }
    if (result.status !== 'passed') return false;

    // за время прогона: активность удалена (и стирание аккаунта, AC-12), основная сменилась, ручной POST успел
    const current = await this.activities.activity(userId, primary.id);
    const head = current ? await primaryOfGroup(this.activities, userId, current) : null;
    if (!head) return false;
    const { rides, live } = await this.routeRides(userId, routeId);
    if (findExisting(rides, live, head.id)) return false;
    if (rides.filter((ride) => live.has(ride.activityId)).length >= ROUTE_RIDE_POLICY.maxPerRoute) {
      return false;
    }
    const now = this.clock.now();
    const doc = {
      ...newRideDoc({ userId, routeId, activity: primary, origin: 'auto', now, result }),
      _id: draft._id,
    };
    if (!(await this.repository.insertChecked(doc))) return false;
    this.logger.log(`route-ride ${doc._id} auto passed`);
    return true;
  }

  /** Свои заезды маршрута и живые из них (основная группы сейчас). */
  private async routeRides(userId: string, routeId: string) {
    const rides = await this.repository.listOwn(userId, routeId);
    const live = await this.activities.liveActivities(
      userId,
      rides.map((ride) => ride.activityId),
    );
    return { rides, live };
  }

  private async groupRideExists(userId: string, routeId: string, primaryId: string) {
    const { rides, live } = await this.routeRides(userId, routeId);
    return findExisting(rides, live, primaryId) !== undefined;
  }

  /** Живые активности и основная их групп — пачками по пределу порта. */
  private async liveHeads(
    userId: string,
    ids: readonly string[],
  ): Promise<Map<string, { primaryId: string }>> {
    const unique = [...new Set(ids)];
    const heads = new Map<string, { primaryId: string }>();
    for (let i = 0; i < unique.length; i += LIVE_BATCH) {
      const part = await this.activities.liveActivities(userId, unique.slice(i, i + LIVE_BATCH));
      for (const [id, head] of part) heads.set(id, head);
    }
    return heads;
  }
}
