import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { AchievementObjects, objectKey } from './achievement-objects';
import { AchievementsReconciler } from './achievements-reconciler';
import {
  ACHIEVEMENTS_POLICY,
  type AchievementOverride,
  type Earned,
  type FactAchievementCode,
  isSeen,
  levelName,
  manuallyGranted,
  progressBeyondManual,
  raceAchievements,
  seasonalAchievements,
  type SeasonalEarned,
  seasonalKey,
  sortForList,
} from './achievements.policy';
import { AchievementsRepository, type StoredGrantDoc } from './achievements.repository';

/**
 * Достижения райдера — HTTP-обёртка (ADR-0020 «выдача сверкой при чтении»): сверка — `AchievementsReconciler` (одна для
 * GET и серверной сверки), публичный список — факты `AchievementFactsReader` и итоги сезонов без записи; запись — только
 * `AchievementsRepository`. Ответы — явным списком полей: без `userId`, id выдачи и времени суток (RC-7). Логи — uid и
 * счётчики, без кодов объектов и названий. Ручные решения команды (achievements-panel, M7) в ответах неотличимы:
 * ручная выдача — объект, дата и уровень из документа, название — `AchievementObjects`; ручной отзыв — как отзыв сверкой.
 */
@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly repository: AchievementsRepository,
    @Inject(RIDER_PROFILES) private readonly profiles: RiderProfileDirectory,
    @Inject(RIDER_RESULTS) private readonly results: RiderResults,
    private readonly reconciler: AchievementsReconciler,
    private readonly facts: AchievementFactsReader,
    private readonly objects: AchievementObjects,
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
    // фактовые видимые — «титулованные факты ∩ видимые»; ручные — из документа (факт этого кода в ответ не идёт)
    const granted = new Map(
      grants
        .filter((grant) => grant.revokedAt === null && !grant.override)
        .map((grant) => [grant.code, grant]),
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
    items.push(...(await this.manualItems(userId, grants.filter(manuallyGranted))));
    for (const grant of seasonGrants) {
      if (grant.revokedAt !== null) continue;
      const item = this.visibleSeasonal(grant, seasonal, outcomes);
      if (item)
        items.push({ ...item, achievement: { ...item.achievement, seen: grant.seenAt !== null } });
    }
    return {
      items: sortForList(items).map((item) => item.achievement),
      progress: progressBeyondManual(progress, grants).map((step) => ({
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
   * Публичные достижения (A7, S6): гоночные (с уровнем `races_5`, L7) и сезонные по `final`-сезонам; без записи, `seen`
   * и прогресса; непубличный и неизвестный — один 404. Выдачи не читаются (RC-S5), кроме ручных решений (RC-1,
   * achievements-panel): отозванный вручную гоночный код / сезонный ключ убирается, выданный вручную `race_*` / `season_*`
   * добавляется (название — `racesOf` / исход сезона). Маршруты и райды — нет (A7).
   */
  async publicList(publicId: string): Promise<PublicRiderAchievementList> {
    const rider = await this.profiles.findPublic(publicId);
    if (!rider) throw domainError('NOT_FOUND', 404);
    const overrides = await this.repository.overridesOf(rider.userId);
    const manualSeasons = overrides.seasonGrants.filter(manuallyGranted);
    const [rows, outcomes] = await Promise.all([
      this.results.publishedRows(rider.userId),
      this.reconciler.seasonOutcomes(
        rider.userId,
        [...new Set(manualSeasons.map((grant) => grant.seasonId))],
        this.clock.now(),
      ),
    ]);
    const races = raceAchievements(rows);
    for (const grant of overrides.grants) {
      if (grant.override.decision === 'revoked') races.delete(grant.code);
      else if (manuallyGranted(grant) && grant.object.kind === 'race')
        races.set(grant.code, {
          object: grant.object,
          factAt: grant.factAt,
          title: null,
          level: grant.level ?? null,
        } satisfies Earned);
    }
    const seasonal = new Map(seasonalAchievements(outcomes).earned);
    for (const grant of overrides.seasonGrants) {
      const key = seasonalKey(grant);
      if (grant.override.decision === 'revoked') {
        seasonal.delete(key);
        continue;
      }
      const outcome = outcomes.find((item) => item.seasonId === grant.seasonId);
      if (manuallyGranted(grant) && outcome)
        seasonal.set(key, {
          code: grant.code,
          seasonId: grant.seasonId,
          factAt: grant.factAt,
          title: outcome.title,
        });
    }
    const titled = await this.facts.titled(races, rider.userId);
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
      ...[...seasonal.values()].map((item) => ({
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
    grant: {
      code: SeasonalEarned['code'];
      seasonId: string;
      factAt: Date;
      revokedAt: Date | null;
      override?: AchievementOverride | null;
    },
    earned: ReadonlyMap<string, SeasonalEarned>,
    outcomes: readonly RiderSeasonOutcome[],
  ) {
    const outcome = outcomes.find((item) => item.seasonId === grant.seasonId);
    if (!outcome) return null;
    // ручная — при любом исходе сезона, независимо от «заработано» (achievements-panel)
    if (outcome.status === 'final' && !manuallyGranted(grant) && !earned.has(seasonalKey(grant)))
      return null;
    return {
      code: grant.code,
      factAt: grant.factAt,
      achievement: seasonalAchievement(grant, outcome.title),
    };
  }

  /**
   * Ручные выдачи в своём списке: объект, дата и уровень — из документа, название — `AchievementObjects` (одна пачка);
   * объект недоступен — элемента нет (лог без id объекта).
   */
  private async manualItems(
    userId: string,
    grants: readonly StoredGrantDoc[],
  ): Promise<{ code: FactAchievementCode; factAt: Date; achievement: Achievement }[]> {
    if (grants.length === 0) return [];
    const titles = await this.objects.titles(
      userId,
      grants.map((grant) => grant.object),
    );
    let missing = false;
    const items = grants.flatMap((grant) => {
      const title = titles.get(objectKey(grant.object));
      if (title === undefined) {
        missing = true;
        return [];
      }
      const level = grant.level ?? null;
      return [
        {
          code: grant.code,
          factAt: grant.factAt,
          achievement: {
            code: grant.code,
            object: { kind: grant.object.kind, id: grant.object.id, title },
            factDate: minskToday(grant.factAt),
            level: level === null ? null : levelName(level),
            seen: isSeen(grant, level),
          },
        },
      ];
    });
    if (missing) this.logger.warn(`achievements.manual_object_missing uid=${userId}`);
    return items;
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
