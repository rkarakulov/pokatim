import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Achievement,
  type AchievementCode,
  type AchievementList,
  minskToday,
  type PublicRiderAchievementList,
  type RateLimitedDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter, type RateLimitRule } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { RIDER_PROFILES, type RiderProfileDirectory } from '../profile';
import { RIDER_RESULTS, type RiderResults } from '../results';
import { RIDER_RIDES, type RiderRides } from '../rides';
import { RIDER_ROUTE_RIDES, type RiderRouteRides } from '../route-rides';
import {
  ACHIEVEMENTS_POLICY,
  type Earned,
  earnedAchievements,
  raceAchievements,
  reconcilePlan,
  type ReconcileStep,
  sortForList,
} from './achievements.policy';
import { AchievementsRepository } from './achievements.repository';

/** Достижение с названием объекта, готовое к ответу. */
type Titled = Earned & { code: AchievementCode; title: string };

/**
 * Достижения райдера — композиция портов (ADR-0020 «выдача сверкой при чтении»): факты — `RIDER_RESULTS`,
 * `RIDER_ROUTE_RIDES`, `RIDER_RIDES`; правила и план сверки — чистые функции `achievements.policy`; запись — только
 * `AchievementsRepository`. Ответы — явным списком полей: без `userId`, id выдачи и времени суток (RC-7). Логи — uid и
 * счётчики, без кодов объектов и названий.
 */
@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly repository: AchievementsRepository,
    @Inject(RIDER_PROFILES) private readonly profiles: RiderProfileDirectory,
    @Inject(RIDER_RESULTS) private readonly results: RiderResults,
    @Inject(RIDER_ROUTE_RIDES) private readonly routeRides: RiderRouteRides,
    @Inject(RIDER_RIDES) private readonly rides: RiderRides,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `GET /v1/achievements`: сверка выдач с фактами (7.2) и список видимых. Без транзакции: каждая запись — одна
   * условная операция; маркер первой сверки — только после её выдач (RC-1). Сбой посередине доводит следующий GET.
   */
  async sync(userId: string): Promise<AchievementList> {
    await this.limit(`achievements-read:${userId}`, ACHIEVEMENTS_POLICY.readLimit);
    const [races, routes, rides] = await Promise.all([
      this.results.publishedRows(userId),
      this.routeRides.passedOf(userId),
      this.rides.pastOf(userId),
    ]);
    const earned = earnedAchievements({ races, routes, rides });
    const [titled, stored, syncedAt] = await Promise.all([
      this.titled(earned, userId),
      this.repository.listOf(userId),
      this.repository.syncedAt(userId),
    ]);
    const first = syncedAt === null;
    const now = this.clock.now();
    const plan = reconcilePlan(stored, earned, first, now);
    for (const step of plan) await this.apply(userId, step, now);
    if (first) await this.repository.markSynced(userId, now);
    if (plan.length > 0) this.logSync(userId, first, plan);

    const seen = new Map(
      (await this.repository.listOf(userId))
        .filter((grant) => grant.revokedAt === null)
        .map((grant) => [grant.code, grant.seenAt !== null]),
    );
    return {
      items: sortForList(titled.filter((item) => seen.has(item.code))).map((item): Achievement => ({
        code: item.code,
        object: { kind: item.object.kind, id: item.object.id, title: item.title },
        factDate: minskToday(item.factAt),
        seen: seen.get(item.code) === true,
      })),
    };
  }

  /** `POST /v1/achievements/seen`: только свои видимые непросмотренные; сверку не запускает. */
  async markSeen(userId: string, codes: readonly AchievementCode[]): Promise<void> {
    await this.limit(`achievements-seen:${userId}`, ACHIEVEMENTS_POLICY.seenLimit);
    await this.repository.markSeen(userId, codes, this.clock.now());
  }

  /** Публичные достижения (A7): только гоночные, без записи и `seen`; непубличный и неизвестный — один 404. */
  async publicList(publicId: string): Promise<PublicRiderAchievementList> {
    const rider = await this.profiles.findPublic(publicId);
    if (!rider) throw domainError('NOT_FOUND', 404);
    const earned = raceAchievements(await this.results.publishedRows(rider.userId));
    const titled = await this.titled(earned, rider.userId);
    return {
      items: sortForList(titled).map((item) => ({
        code: item.code,
        object: { kind: item.object.kind, id: item.object.id, title: item.title },
        factDate: minskToday(item.factAt),
      })),
    };
  }

  /** Названия объектов: гонки — `racesOf` (≤ 4 id); нет гонки в карте — код не в ответе (запись не трогается). */
  private async titled(earned: Map<AchievementCode, Earned>, userId: string): Promise<Titled[]> {
    const raceIds = [...earned.values()]
      .filter((item) => item.object.kind === 'race')
      .map((item) => item.object.id);
    const races = raceIds.length > 0 ? await this.results.racesOf(raceIds) : new Map();
    const result: Titled[] = [];
    let missing = false;
    for (const [code, item] of earned) {
      const title = item.object.kind === 'race' ? races.get(item.object.id)?.title : item.title;
      if (title === undefined || title === null) missing = true;
      else result.push({ ...item, code, title });
    }
    if (missing) this.logger.warn(`achievements.race_missing uid=${userId}`);
    return result;
  }

  private async apply(userId: string, step: ReconcileStep, now: Date): Promise<void> {
    switch (step.type) {
      case 'insert':
        await this.repository.insertGrant(userId, step.code, step.earned, step.seenAt, now);
        return;
      case 'revoke':
        await this.repository.revoke(userId, step.code, now);
        return;
      case 'restore':
      case 'refresh':
        await this.repository.restoreOrRefresh(userId, step.code, step.earned, now);
        return;
    }
  }

  private logSync(userId: string, first: boolean, plan: readonly ReconcileStep[]): void {
    const count = (type: ReconcileStep['type']) => plan.filter((step) => step.type === type).length;
    this.logger.log(
      `achievements.sync uid=${userId} first=${first} granted=${count('insert')} revoked=${count('revoke')} restored=${count('restore')}`,
    );
  }

  private async limit(key: string, rule: RateLimitRule): Promise<void> {
    const limited = await this.rateLimiter.consume(key, rule, this.clock.now());
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }
}
