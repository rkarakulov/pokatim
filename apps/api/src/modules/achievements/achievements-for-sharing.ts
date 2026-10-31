import { Inject, Injectable } from '@nestjs/common';
import { minskToday, type SeasonalAchievementCode } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { RIDER_SEASON_STANDINGS, type RiderSeasonStandings } from '../standings';
import { AchievementFactsReader } from './achievement-facts.reader';
import { AchievementObjects, objectKey } from './achievement-objects';
import {
  type FactAchievementCode,
  levelName,
  manuallyGranted,
  seasonalAchievements,
  seasonalKey,
} from './achievements.policy';
import type {
  AchievementCardFacts,
  AchievementCardRef,
  AchievementsForSharing,
} from './achievements-for-sharing.port';
import { AchievementsRepository } from './achievements.repository';

/**
 * Реализация `ACHIEVEMENTS_FOR_SHARING`: факты читателя ∩ не отозванная выдача; без записей. Ручная выдача
 * (achievements-panel, RC-1) — объект, дата и уровень из документа, название — `AchievementObjects`; ручной отзыв —
 * `revokedAt` → `null`. Сезонное (C4) — выдача `(code, seasonId)` и исход сезона из порта `RIDER_SEASON_STANDINGS`
 * напрямую (сбой — исключение, не «нет права», RC-5).
 */
@Injectable()
export class AchievementsSharing implements AchievementsForSharing {
  constructor(
    private readonly facts: AchievementFactsReader,
    private readonly repository: AchievementsRepository,
    private readonly objects: AchievementObjects,
    @Inject(RIDER_SEASON_STANDINGS) private readonly standings: RiderSeasonStandings,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  cardFacts(userId: string, ref: AchievementCardRef): Promise<AchievementCardFacts | null> {
    return ref.seasonId === null
      ? this.factFacts(userId, ref.code)
      : this.seasonalFacts(userId, { code: ref.code, seasonId: ref.seasonId });
  }

  /**
   * Сезонное (C4, RC-2): выдача не отозвана; ручная — при любом исходе сезона; иначе только `final` и заработана сейчас
   * (`pending` без ручной — `null`). Сезон не завершён или пропал из ответа порта — `null`. Форма и дата — как у
   * сезонного элемента списка `GET /v1/achievements` (дата — `grant.factAt`, RC-10).
   */
  private async seasonalFacts(
    userId: string,
    key: { code: SeasonalAchievementCode; seasonId: string },
  ): Promise<AchievementCardFacts | null> {
    const grant = (await this.repository.listSeasonalOf(userId)).find(
      (doc) => doc.code === key.code && doc.seasonId === key.seasonId && doc.revokedAt === null,
    );
    if (!grant) return null;
    const outcome = (
      await this.standings.outcomesOf(userId, [key.seasonId], this.clock.now())
    ).find((item) => item.seasonId === key.seasonId);
    if (!outcome) return null;
    if (
      !manuallyGranted(grant) &&
      (outcome.status !== 'final' || !seasonalAchievements([outcome]).earned.has(seasonalKey(key)))
    )
      return null;
    return {
      code: key.code,
      object: { kind: 'season', id: key.seasonId, title: outcome.title },
      factDate: minskToday(grant.factAt),
      level: null,
    };
  }

  private async factFacts(
    userId: string,
    code: FactAchievementCode,
  ): Promise<AchievementCardFacts | null> {
    const [{ earned }, grants] = await Promise.all([
      this.facts.evaluate(userId),
      this.repository.listOf(userId),
    ]);
    const grant = grants.find((doc) => doc.code === code && doc.revokedAt === null);
    if (grant?.override?.decision === 'granted') {
      const title = (await this.objects.titles(userId, [grant.object])).get(
        objectKey(grant.object),
      );
      if (title === undefined) return null;
      return {
        code,
        object: { kind: grant.object.kind, id: grant.object.id, title },
        factDate: minskToday(grant.factAt),
        level: grant.level == null ? null : levelName(grant.level),
      };
    }
    const item = earned.get(code);
    if (!item || !grant) return null;
    const [titled] = await this.facts.titled(new Map([[code, item]]), userId);
    if (!titled) return null;
    return {
      code,
      object: { kind: titled.object.kind, id: titled.object.id, title: titled.title },
      factDate: minskToday(titled.factAt),
      level: titled.level === null ? null : levelName(titled.level),
    };
  }
}
