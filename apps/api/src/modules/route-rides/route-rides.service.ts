import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RateLimitedDetails, RouteRideDetail, RouteRideRequest } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, MongoOutboxWriter, MongoTransactions } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { ACTIVITY_SOURCE, type ActivityRef, type ActivitySource } from '../tracks';
import { ROUTE_RIDES_CHECK_REQUESTED, type RouteRidesCheckRequested } from './route-rides.events';
import {
  effectiveStatus,
  findExisting,
  newRideDoc,
  primaryOfGroup,
  ROUTE_RIDE_DELETE_POLICY,
  ROUTE_RIDE_POLICY,
  stuckBounds,
} from './route-rides.policy';
import { RouteRidesReadService } from './route-rides-read.service';
import { ROUTE_RIDES_UNIQUE_INDEX, RouteRidesRepository } from './route-rides.repository';

const notFound = () => domainError('NOT_FOUND', 404);
const notReady = () => domainError('ROUTE_RIDE_NOT_READY', 409);

export type RouteRideCheckOutcome = 'created' | 'existing' | 'requeued';

/**
 * «Проверить заезд» по маршруту (route-rides-01, §7 шаг 7): лимит → видимость маршрута → своя основная активность
 * группы (`activityId` дубля и `uploadId` — к основной, 8.1 RC-7) → существующий заезд группы (тот же; `failed` или
 * зависший — новая ревизия проверки) → иначе квота и новый `queued` + outbox в одной транзакции.
 */
@Injectable()
export class RouteRidesService {
  private readonly logger = new Logger(RouteRidesService.name);

  constructor(
    private readonly repository: RouteRidesRepository,
    private readonly read: RouteRidesReadService,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async check(
    userId: string,
    routeId: string,
    input: RouteRideRequest,
  ): Promise<{ ride: RouteRideDetail; created: boolean }> {
    // до всего: считает повторы и 404 (анти-перебор)
    await this.limit(`route-rides-user:${userId}`, ROUTE_RIDE_POLICY.userLimit);
    await this.read.route(routeId, userId);
    const primary = await this.primaryOf(userId, input);

    const rides = await this.repository.listOwn(userId, routeId);
    const heads = await this.activities.liveActivities(
      userId,
      rides.map((ride) => ride.activityId),
    );
    const now = this.clock.now();
    const existing = findExisting(rides, heads, primary.id);
    let rideId: string;
    let outcome: RouteRideCheckOutcome;
    if (existing) {
      rideId = existing._id;
      outcome =
        effectiveStatus(existing, now).status === 'failed' &&
        (await this.requeue(existing._id, existing.checkRevision, now))
          ? 'requeued'
          : 'existing';
    } else {
      const live = rides.filter((ride) => heads.has(ride.activityId));
      if (live.length >= ROUTE_RIDE_POLICY.maxPerRoute) {
        throw domainError('ROUTE_RIDE_QUOTA_EXCEEDED', 409);
      }
      const orphans = rides.filter((ride) => !heads.has(ride.activityId)).map((ride) => ride._id);
      const created = await this.create(userId, routeId, primary, orphans, now);
      rideId = created.id;
      outcome = created.outcome;
    }
    this.logger.log(`route-ride ${rideId} route ${routeId} user ${userId} ${outcome}`);
    return {
      ride: await this.read.detail(userId, routeId, rideId),
      created: outcome === 'created',
    };
  }

  /**
   * Удаление своего заезда (route-rides-07): лимит до чтений → видимость маршрута → заезд свой и этого маршрута, любой
   * статус (итог идущей проверки промахнётся по `_id`); иначе `404`. Лучшие, «Другие» и участки считаются на чтении.
   */
  async delete(userId: string, routeId: string, rideId: string): Promise<void> {
    await this.limit(`route-rides-delete:${userId}`, ROUTE_RIDE_DELETE_POLICY.userLimit);
    await this.read.route(routeId, userId);
    const deleted = await this.transactions.run((tx) =>
      this.repository.deleteOwn(tx, userId, routeId, rideId),
    );
    if (!deleted) throw notFound();
    this.logger.log(`route-ride ${rideId} route ${routeId} user ${userId} deleted`);
  }

  /** Своя основная активность группы: по `activityId` (дубль — к основной) или по готовой загрузке. */
  private async primaryOf(userId: string, input: RouteRideRequest): Promise<ActivityRef> {
    let activity: ActivityRef | null;
    if ('activityId' in input) {
      activity = await this.activities.activity(userId, input.activityId);
      if (!activity) throw notFound();
    } else {
      const upload = await this.activities.uploadState(userId, input.uploadId);
      if (!upload) throw notFound();
      if (upload.status === 'queued' || upload.status === 'processing') throw notReady();
      if (upload.status === 'failed' || upload.status === 'skipped') {
        throw domainError('ROUTE_RIDE_UPLOAD_FAILED', 409);
      }
      activity = upload.activity;
      if (!activity) throw notReady();
    }
    // основная группы сменилась или удалена между чтениями — как неизвестная
    const primary = await primaryOfGroup(this.activities, userId, activity);
    if (!primary) throw notFound();
    return primary;
  }

  /** `failed`/зависший прежней ревизии → новая ревизия + событие; `false` — проиграл гонку (уже перепоставлен). */
  private requeue(id: string, checkRevision: number, now: Date): Promise<boolean> {
    return this.transactions.run(async (tx) => {
      const requeued = await this.repository.requeue(tx, id, checkRevision, stuckBounds(now), now);
      if (requeued) await this.requestCheck(tx, id, checkRevision + 1);
      return requeued;
    });
  }

  private async create(
    userId: string,
    routeId: string,
    activity: ActivityRef,
    orphans: readonly string[],
    now: Date,
  ): Promise<{ id: string; outcome: RouteRideCheckOutcome }> {
    const doc = newRideDoc({ userId, routeId, activity, origin: 'manual', now });
    try {
      await this.transactions.run(async (tx) => {
        await this.repository.deleteOrphans(tx, userId, routeId, orphans);
        await this.repository.insert(tx, doc);
        await this.requestCheck(tx, doc._id, doc.checkRevision);
      });
      return { id: doc._id, outcome: 'created' };
    } catch (error) {
      // параллельный POST той же группы — заезд уже есть
      if (!isDuplicateKey(error, ROUTE_RIDES_UNIQUE_INDEX)) throw error;
      const winner = await this.repository.findByActivity(userId, routeId, activity.id);
      if (!winner) throw error;
      return { id: winner._id, outcome: 'existing' };
    }
  }

  private async requestCheck(tx: DbSession, rideId: string, checkRevision: number) {
    const payload: RouteRidesCheckRequested = { rideId, checkRevision };
    await this.outbox.append(tx, { type: ROUTE_RIDES_CHECK_REQUESTED, payload });
  }

  private async limit(key: string, rule: { limit: number; windowSec: number }): Promise<void> {
    const result = await this.rateLimiter.consume(key, rule, this.clock.now());
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }
}
