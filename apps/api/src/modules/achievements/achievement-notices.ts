import { Inject, Injectable } from '@nestjs/common';

import { RIDER_SEASON_STANDINGS, type RiderSeasonStandings } from '../standings';
import { AchievementFactsReader } from './achievement-facts.reader';
import type { AchievementNotice, AchievementNotices } from './achievement-notices.port';
import type { AchievementsGrantNoticed } from './achievements.events';
import { seasonalAchievements, seasonalKey, storedRank } from './achievements.policy';
import { AchievementsRepository } from './achievements.repository';

/**
 * Реализация `ACHIEVEMENT_NOTICES` (5.B): выдача по `_id` своего репозитория → несезонная — факты
 * `AchievementFactsReader.evaluate` + `titled` (подтверждает, что код заработан, и даёт название объекта); сезонная —
 * актуальный итог `RIDER_SEASON_STANDINGS.outcomesOf` + `seasonalAchievements`: код заработан по `final`-исходу
 * (название — из исхода), иначе — `state` (в том числе `pending`: пересчёт ещё не подтвердил место). Без записи.
 */
@Injectable()
export class AchievementNoticesService implements AchievementNotices {
  constructor(
    private readonly repository: AchievementsRepository,
    private readonly facts: AchievementFactsReader,
    @Inject(RIDER_SEASON_STANDINGS) private readonly standings: RiderSeasonStandings,
  ) {}

  async notice(
    event: AchievementsGrantNoticed,
    now: Date,
  ): Promise<AchievementNotice | 'gone' | 'state'> {
    const grant = await this.repository.findGrant(event.grant, event.grantId);
    if (!grant) return 'gone';
    if (grant.revokedAt !== null) return 'state';
    if (grant.grant === 'season') {
      const outcomes = await this.standings.outcomesOf(grant.userId, [grant.seasonId], now);
      // `pending` (снимок устарел, протокол ожидается) не подтверждает код — `state`, без ложного «Новое достижение»
      const earned = seasonalAchievements(outcomes).earned.get(seasonalKey(grant));
      if (!earned) return 'state';
      return {
        userId: grant.userId,
        code: grant.code,
        level: null,
        object: { kind: 'season', title: earned.title },
        seasonId: grant.seasonId,
      };
    }
    if (event.level !== null && storedRank(grant) < event.level) return 'state';
    const fact = (await this.facts.evaluate(grant.userId)).earned.get(grant.code);
    if (!fact || (fact.level ?? 1) < (event.level ?? 1)) return 'state';
    const [titled] = await this.facts.titled(new Map([[grant.code, fact]]), grant.userId);
    if (!titled) return 'state';
    return {
      userId: grant.userId,
      code: grant.code,
      level: event.level,
      object: { kind: titled.object.kind, title: titled.title },
      seasonId: null,
    };
  }
}
