import { Inject, Injectable } from '@nestjs/common';
import {
  type Achievement,
  type AchievementCode,
  type AchievementList,
  minskToday,
  type PublicRiderAchievementList,
  type RateLimitedDetails,
  type SeasonalAchievementRef,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter, type RateLimitRule } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { RIDER_PROFILES, type RiderProfileDirectory } from '../profile';
import { RIDER_RESULTS, type RiderResults } from '../results';
import type { RiderSeasonOutcome } from '../standings';
import { AchievementFactsReader } from './achievement-facts.reader';
import { AchievementsReconciler } from './achievements-reconciler';
import {
  ACHIEVEMENTS_POLICY,
  isSeen,
  levelName,
  raceAchievements,
  seasonalAchievements,
  type SeasonalEarned,
  seasonalKey,
  sortForList,
} from './achievements.policy';
import { AchievementsRepository } from './achievements.repository';

/**
 * Достижения райдера — HTTP-обёртка (ADR-0020 «выдача сверкой при чтении»): сверка — `AchievementsReconciler` (одна для
 * GET и серверной сверки), публичный список — факты `AchievementFactsReader` и итоги сезонов без записи; запись — только
 * `AchievementsRepository`. Ответы — явным списком полей: без `userId`, id выдачи и времени суток (RC-7). Логи — uid и
 * счётчики, без кодов объектов и названий.
 */
@Injectable()
export class AchievementsService {
  constructor(
    private readonly repository: AchievementsRepository,
    @Inject(RIDER_PROFILES) private readonly profiles: RiderProfileDirectory,
    @Inject(RIDER_RESULTS) private readonly results: RiderResults,
    private readonly reconciler: AchievementsReconciler,
    private readonly facts: AchievementFactsReader,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `GET /v1/achievements`: лимит пользователя → сверка `AchievementsReconciler.reconcile(userId, 'read')` (выдачи,
   * уведомление о новой выдаче — только центр, P1) → список видимых. Сбой посередине доводит следующий GET.
   */
  async sync(userId: string): Promise<AchievementList> {
    await this.limit(`achievements-read:${userId}`, ACHIEVEMENTS_POLICY.readLimit);
    const { titled, progress, seasonal, outcomes } = await this.reconciler.reconcile(
      userId,
      'read',
    );

    // `seen` — по уровню ответа (фактов этого запроса), а не сохранённому: устаревший параллельный план мог записать
    // меньший уровень (RC-L10)
    const [grants, seasonGrants] = await Promise.all([
      this.repository.listOf(userId),
      this.repository.listSeasonalOf(userId),
    ]);
    const granted = new Map(
      grants.filter((grant) => grant.revokedAt === null).map((grant) => [grant.code, grant]),
    );
    const items: { code: AchievementCode; factAt: Date; achievement: Achievement }[] = titled
      .filter((item) => granted.has(item.code))
      .map((item) => ({
        code: item.code,
        factAt: item.factAt,
        achievement: {
          code: item.code,
          object: { kind: item.object.kind, id: item.object.id, title: item.title },
          factDate: minskToday(item.factAt),
          level: item.level === null ? null : levelName(item.level),
          seen: isSeen(granted.get(item.code)!, item.level),
        },
      }));
    for (const grant of seasonGrants) {
      if (grant.revokedAt !== null) continue;
      const item = this.visibleSeasonal(grant, seasonal, outcomes);
      if (item)
        items.push({ ...item, achievement: { ...item.achievement, seen: grant.seenAt !== null } });
    }
    return {
      items: sortForList(items).map((item) => item.achievement),
      progress: progress.map((step) => ({
        code: step.code,
        level: levelName(step.level),
        current: step.current,
        target: step.target,
      })),
    };
  }

  /** `POST /v1/achievements/seen`: только свои видимые непросмотренные; сверку не запускает. */
  async markSeen(
    userId: string,
    {
      codes,
      seasonal,
    }: { codes: readonly AchievementCode[]; seasonal: readonly SeasonalAchievementRef[] },
  ): Promise<void> {
    await this.limit(`achievements-seen:${userId}`, ACHIEVEMENTS_POLICY.seenLimit);
    await this.repository.markSeen(userId, codes, seasonal, this.clock.now());
  }

  /**
   * Публичные достижения (A7, S6): гоночные (с уровнем `races_5`, L7) и сезонные по `final`-сезонам (без чтения выдач,
   * RC-S5); без записи, `seen` и прогресса; непубличный и неизвестный — один 404.
   */
  async publicList(publicId: string): Promise<PublicRiderAchievementList> {
    const rider = await this.profiles.findPublic(publicId);
    if (!rider) throw domainError('NOT_FOUND', 404);
    const [rows, outcomes] = await Promise.all([
      this.results.publishedRows(rider.userId),
      this.reconciler.seasonOutcomes(rider.userId, [], this.clock.now()),
    ]);
    const titled = await this.facts.titled(raceAchievements(rows), rider.userId);
    const items = [
      ...titled.map((item) => ({
        code: item.code,
        factAt: item.factAt,
        achievement: {
          code: item.code,
          object: { kind: item.object.kind, id: item.object.id, title: item.title },
          factDate: minskToday(item.factAt),
          level: item.level === null ? null : levelName(item.level),
        },
      })),
      ...[...seasonalAchievements(outcomes).earned.values()].map((item) => ({
        code: item.code,
        factAt: item.factAt,
        achievement: seasonalAchievement(item, item.title),
      })),
    ];
    return { items: sortForList(items).map((item) => item.achievement) };
  }

  /**
   * Видимая сезонная выдача в своём списке (S2): сезон `final` — только заработанная сейчас; сезон `pending` —
   * остаётся (не мерцает между ревизией и пересчётом), название — из исхода порта; сезон пропал из ответа порта — нет.
   */
  private visibleSeasonal(
    grant: { code: SeasonalEarned['code']; seasonId: string; factAt: Date },
    earned: ReadonlyMap<string, SeasonalEarned>,
    outcomes: readonly RiderSeasonOutcome[],
  ) {
    const outcome = outcomes.find((item) => item.seasonId === grant.seasonId);
    if (!outcome) return null;
    if (outcome.status === 'final' && !earned.has(seasonalKey(grant))) return null;
    return {
      code: grant.code,
      factAt: grant.factAt,
      achievement: seasonalAchievement(grant, outcome.title),
    };
  }

  private async limit(key: string, rule: RateLimitRule): Promise<void> {
    const limited = await this.rateLimiter.consume(key, rule, this.clock.now());
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }
}

/** Сезонное достижение для ответа (S3): объект — сезон с текущим названием, дата — последний день сезона по Минску. */
function seasonalAchievement(
  item: { code: SeasonalEarned['code']; seasonId: string; factAt: Date },
  title: string,
) {
  return {
    code: item.code,
    object: { kind: 'season' as const, id: item.seasonId, title },
    factDate: minskToday(item.factAt),
    level: null,
  };
}
