import { Inject, Injectable } from '@nestjs/common';
import {
  addLocalDays,
  type CurrentSeasonResponse,
  minskDayStartUtc,
  type RaceCard,
  type RaceDetail,
  type RaceListQuery,
  type RacePage,
  UtcMinute,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import type { RaceDoc } from './races.collection';
import { RACE_POLICY, racePhase, seasonPhase } from './races.policy';
import { type InstantRange, RacesRepository } from './races.repository';

/** Месяц `YYYY-MM` по Минску как диапазон моментов. */
function monthRange(month: string): InstantRange {
  const first = `${month}-01`;
  const next = addLocalDays(`${month}-28`, 4).slice(0, 7);
  return { startsAt: minskDayStartUtc(first), endsBefore: minskDayStartUtc(`${next}-01`) };
}

/**
 * Read-модель гонок и сезона для приложения (§13, Q14): только опубликованные и отменённые гонки, без владельца и
 * служебных полей (`version`, `ownerUserId`). Фаза — по `CLOCK` сервера.
 */
@Injectable()
export class RacesPublicService {
  constructor(
    private readonly repository: RacesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: RaceListQuery): Promise<RacePage> {
    const now = this.clock.now();
    const after = query.cursor ? decodeCursor(query.cursor, UtcMinute) : null;
    const docs = await this.repository.listPublic(
      {
        scope: query.scope,
        closedBefore: new Date(now.getTime() - RACE_POLICY.windowEndGraceMs),
        bikeClasses: query.bikeClass,
        months: query.month?.map(monthRange),
      },
      after ? { k: new Date(after.k), id: after.id } : null,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    const key = (race: RaceDoc) =>
      (query.scope === 'current' ? race.windowStartsAt : race.windowEndsAt).toISOString();
    return {
      items: await this.cards(page, now),
      nextCursor: docs.length > query.limit && last ? encodeCursor(key(last), last._id) : null,
    };
  }

  async get(id: string): Promise<RaceDetail> {
    const race = await this.repository.findPublic(id);
    if (!race) throw domainError('NOT_FOUND', 404);
    const [card] = await this.cards([race], this.clock.now());
    if (!card) throw domainError('NOT_FOUND', 404);
    return { ...card, description: race.description };
  }

  async currentSeason(): Promise<CurrentSeasonResponse> {
    const now = this.clock.now();
    const season = await this.repository.seasonCovering(now);
    return {
      season: season
        ? {
            id: season._id,
            name: season.name,
            startsOn: season.startsOn,
            endsOn: season.endsOn,
            phase: seasonPhase(season, now),
          }
        : null,
    };
  }

  private async cards(races: readonly RaceDoc[], now: Date): Promise<RaceCard[]> {
    if (races.length === 0) return [];
    const seasons = new Map(
      (await this.repository.listSeasons()).map((season) => [season._id, season.name]),
    );
    return races.map((race) => {
      const seasonName = race.seasonId ? seasons.get(race.seasonId) : undefined;
      return {
        id: race._id,
        title: race.title,
        bikeClass: race.bikeClass,
        surfaces: race.surfaces,
        distanceKm: race.distanceKm,
        windowStartsAt: race.windowStartsAt.toISOString(),
        windowEndsAt: race.windowEndsAt.toISOString(),
        protocolPlannedAt: race.protocolPlannedAt.toISOString(),
        phase: racePhase(race, now),
        cancelReason: race.cancelReason,
        season:
          race.seasonId && seasonName !== undefined
            ? { id: race.seasonId, name: seasonName }
            : null,
      };
    });
  }
}
