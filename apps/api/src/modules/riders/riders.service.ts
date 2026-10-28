import { Inject, Injectable } from '@nestjs/common';
import type {
  PublicRiderProfile,
  PublicRiderRacePage,
  RiderHistoryQuery,
  RiderStats,
} from '@pokatim/contracts';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { RIDER_PROFILES, type RiderProfileDirectory } from '../profile';
import { RIDER_RESULTS, type RiderResults } from '../results';
import { ACTIVITY_TOTALS, type ActivityTotals } from '../tracks';
import { pageRows, summarize } from './riders.policy';

const notFound = () => domainError('NOT_FOUND', 404);
const invalidCursor = () =>
  domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'cursor', code: 'INVALID' }] });
/** Курсор публичной истории — только id гонки (ключ-константа): без времени заезда (HIGH-1 ревью). */
const RACE_CURSOR_KEY = 'r';
const RaceCursorKey = z.literal(RACE_CURSOR_KEY);

/**
 * Профиль райдера — композиция портов (rider-profile): `profile` (публичный профиль по `publicId`), `results` (строки
 * текущих ревизий опубликованных протоколов), `tracks` (суммы заездов). Своих коллекций нет. Публичные ответы —
 * явным списком полей: без `userId`, км, набора и райдов.
 */
@Injectable()
export class RidersService {
  constructor(
    @Inject(RIDER_PROFILES) private readonly profiles: RiderProfileDirectory,
    @Inject(RIDER_RESULTS) private readonly results: RiderResults,
    @Inject(ACTIVITY_TOTALS) private readonly totals: ActivityTotals,
  ) {}

  /** Своя статистика: заезды и суммы — по основным велоактивностям, гонки — по опубликованным протоколам. */
  async stats(userId: string): Promise<RiderStats> {
    const [totals, rows] = await Promise.all([
      this.totals.of(userId),
      this.results.publishedRows(userId),
    ]);
    const summary = summarize(rows);
    const races = await this.results.racesOf(summary.bestPlaces.map((row) => row.raceId));
    return {
      activities: totals.activities,
      distanceM: Math.round(totals.distanceM),
      elevationGainM: Math.round(totals.elevationGainM),
      races: summary.races,
      podiums: summary.podiums,
      bestPlaces: summary.bestPlaces.flatMap((row) => {
        const race = races.get(row.raceId);
        if (!race || row.place === null) return [];
        return [
          {
            race: {
              id: row.raceId,
              title: race.title,
              windowStartsAt: race.windowStartsAt.toISOString(),
            },
            place: row.place,
            tied: row.tied,
            groupKey: row.groupKey,
          },
        ];
      }),
    };
  }

  /** Публичный профиль: только при имени и согласии, иначе 404. */
  async publicProfile(publicId: string): Promise<PublicRiderProfile> {
    const rider = await this.profiles.findPublic(publicId);
    if (!rider) throw notFound();
    const summary = summarize(await this.results.publishedRows(rider.userId));
    return {
      publicId,
      name: rider.publicName,
      club: rider.club,
      avatar: rider.avatarId ? { id: rider.avatarId } : null,
      stats: {
        races: summary.races,
        podiums: summary.podiums,
        bestPlace: summary.bestPlaces[0]?.place ?? null,
      },
    };
  }

  /** Публичная история: 404 профиля — до разбора курсора; только строки опубликованных протоколов. */
  async publicRaces(publicId: string, query: RiderHistoryQuery): Promise<PublicRiderRacePage> {
    const rider = await this.profiles.findPublic(publicId);
    if (!rider) throw notFound();
    const cursor = query.cursor ? decodeCursor(query.cursor, RaceCursorKey) : null;
    const paged = pageRows(await this.results.publishedRows(rider.userId), cursor, query.limit);
    if (!paged) throw invalidCursor();
    const { page, next } = paged;
    const races = await this.results.racesOf(page.map((row) => row.raceId));
    return {
      items: page.flatMap((row) => {
        const race = races.get(row.raceId);
        if (!race) return [];
        return [
          {
            race: {
              id: row.raceId,
              title: race.title,
              windowStartsAt: race.windowStartsAt.toISOString(),
            },
            place: row.place,
            tied: row.tied,
            status: row.status,
            groupKey: row.groupKey,
            elapsedSec: row.elapsedSec,
          },
        ];
      }),
      nextCursor: next ? encodeCursor(RACE_CURSOR_KEY, next.id) : null,
    };
  }
}
