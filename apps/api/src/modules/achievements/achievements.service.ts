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
import { AchievementFactsReader } from './achievement-facts.reader';
import {
  ACHIEVEMENTS_POLICY,
  isSeen,
  levelName,
  raceAchievements,
  reconcilePlan,
  type ReconcileStep,
  sortForList,
} from './achievements.policy';
import { AchievementsRepository } from './achievements.repository';

/**
 * Достижения райдера — композиция портов (ADR-0020 «выдача сверкой при чтении»): факты — `AchievementFactsReader`
 * (`RIDER_RESULTS`, `RIDER_ROUTE_RIDES`, `RIDER_RIDES`); правила и план сверки — чистые функции `achievements.policy`; запись — только
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
    private readonly facts: AchievementFactsReader,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `GET /v1/achievements`: сверка выдач с фактами (7.2) и список видимых. Без транзакции: каждая запись — одна
   * условная операция; маркер первой сверки — только после её выдач (RC-1). Сбой посередине доводит следующий GET.
   */
  async sync(userId: string): Promise<AchievementList> {
    await this.limit(`achievements-read:${userId}`, ACHIEVEMENTS_POLICY.readLimit);
    const { earned, progress } = await this.facts.evaluate(userId);
    const [titled, stored, syncedAt] = await Promise.all([
      this.facts.titled(earned, userId),
      this.repository.listOf(userId),
      this.repository.syncedAt(userId),
    ]);
    const first = syncedAt === null;
    const now = this.clock.now();
    const plan = reconcilePlan(stored, earned, first, now);
    for (const step of plan) await this.apply(userId, step, now);
    if (first) await this.repository.markSynced(userId, now);
    if (plan.length > 0) this.logSync(userId, first, plan);

    // `seen` — по уровню ответа (фактов этого запроса), а не сохранённому: устаревший параллельный план мог записать
    // меньший уровень (RC-L10)
    const granted = new Map(
      (await this.repository.listOf(userId))
        .filter((grant) => grant.revokedAt === null)
        .map((grant) => [grant.code, grant]),
    );
    return {
      items: sortForList(titled.filter((item) => granted.has(item.code))).map(
        (item): Achievement => ({
          code: item.code,
          object: { kind: item.object.kind, id: item.object.id, title: item.title },
          factDate: minskToday(item.factAt),
          level: item.level === null ? null : levelName(item.level),
          seen: isSeen(granted.get(item.code)!, item.level),
        }),
      ),
      progress: progress.map((step) => ({
        code: step.code,
        level: levelName(step.level),
        current: step.current,
        target: step.target,
      })),
    };
  }

  /** `POST /v1/achievements/seen`: только свои видимые непросмотренные; сверку не запускает. */
  async markSeen(userId: string, codes: readonly AchievementCode[]): Promise<void> {
    await this.limit(`achievements-seen:${userId}`, ACHIEVEMENTS_POLICY.seenLimit);
    await this.repository.markSeen(userId, codes, this.clock.now());
  }

  /**
   * Публичные достижения (A7): только гоночные, с уровнем `races_5` (L7), без записи, `seen` и прогресса; непубличный и
   * неизвестный — один 404.
   */
  async publicList(publicId: string): Promise<PublicRiderAchievementList> {
    const rider = await this.profiles.findPublic(publicId);
    if (!rider) throw domainError('NOT_FOUND', 404);
    const earned = raceAchievements(await this.results.publishedRows(rider.userId));
    const titled = await this.facts.titled(earned, rider.userId);
    return {
      items: sortForList(titled).map((item) => ({
        code: item.code,
        object: { kind: item.object.kind, id: item.object.id, title: item.title },
        factDate: minskToday(item.factAt),
        level: item.level === null ? null : levelName(item.level),
      })),
    };
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
        await this.repository.restoreOrRefresh(
          userId,
          step.code,
          step.earned,
          step.type === 'restore',
          now,
        );
        return;
    }
  }

  private logSync(userId: string, first: boolean, plan: readonly ReconcileStep[]): void {
    const count = (type: ReconcileStep['type']) => plan.filter((step) => step.type === type).length;
    this.logger.log(
      `achievements.sync uid=${userId} first=${first} granted=${count('insert')} revoked=${count('revoke')} restored=${count('restore')} refreshed=${count('refresh')}`,
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
