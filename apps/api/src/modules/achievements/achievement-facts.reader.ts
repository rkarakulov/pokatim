import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AchievementCode } from '@pokatim/contracts';

import { RIDER_RESULTS, type RiderResults } from '../results';
import { RIDER_RIDES, type RiderRides } from '../rides';
import { RIDER_ROUTE_RIDES, type RiderRouteRides } from '../route-rides';
import { type Earned, type Evaluation, evaluateAchievements } from './achievements.policy';

/** Достижение с названием объекта, готовое к ответу. */
export type Titled = Earned & { code: AchievementCode; title: string };

/**
 * Факты достижений райдера — порты владельцев (`RIDER_RESULTS`, `RIDER_ROUTE_RIDES`, `RIDER_RIDES`) и правила
 * `achievements.policy`; только чтение. Общая часть сверки (`AchievementsService`) и порта карточки
 * (`ACHIEVEMENTS_FOR_SHARING`).
 */
@Injectable()
export class AchievementFactsReader {
  private readonly logger = new Logger(AchievementFactsReader.name);

  constructor(
    @Inject(RIDER_RESULTS) private readonly results: RiderResults,
    @Inject(RIDER_ROUTE_RIDES) private readonly routeRides: RiderRouteRides,
    @Inject(RIDER_RIDES) private readonly rides: RiderRides,
  ) {}

  /** Заработанные сейчас и прогресс к следующему уровню: факты параллельно → правила (одна сортировка). */
  async evaluate(userId: string): Promise<Evaluation> {
    const [races, routes, rides] = await Promise.all([
      this.results.publishedRows(userId),
      this.routeRides.passedOf(userId),
      this.rides.pastOf(userId),
    ]);
    return evaluateAchievements({ races, routes, rides });
  }

  /** Названия объектов: гонки — `racesOf` (≤ 4 id); нет гонки в карте — код не в ответе (запись не трогается). */
  async titled(earned: Map<AchievementCode, Earned>, userId: string): Promise<Titled[]> {
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
}
