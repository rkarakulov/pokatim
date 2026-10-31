import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { achievementsCollections } from '../src/modules/achievements/achievements.collection';
import { DAY, type Harness } from './harness';
import { routeRidesDb } from './route-rides';
import { resultsDb } from './results';
import { createRide, join, type Rider, ridesDb } from './rides';
import { placedRow, type SeedRow, seedProtocolRace } from './standings';
import { tracks } from './tracks';

/** Коллекции модуля `achievements` тестовой БД. */
export const achievementsDb = (h: Harness) => achievementsCollections(h.db);

export const ACHIEVEMENTS = '/v1/achievements';

/** Момент `days` дней назад от «сейчас» стенда. */
export const daysAgo = (h: Harness, days: number) => new Date(h.clock.now().getTime() - days * DAY);

/**
 * Опубликованная гонка с протоколом (`seedProtocolRace`), строки которой стартовали `at` — дата факта гоночного
 * достижения (старт лучшего сегмента).
 */
export async function raceAt(
  h: Harness,
  seasonId: string,
  rows: readonly SeedRow[],
  at: Date,
  title = 'Гонка',
): Promise<string> {
  const raceId = await seedProtocolRace(h, seasonId, rows, { title });
  await resultsDb(h).protocolRows.updateMany({ raceId }, { $set: { startedAt: at } });
  return raceId;
}

/** Основная велоактивность напрямую в БД (заезду по маршруту нужна живая активность). */
export async function seedActivity(h: Harness, userId: string, startedAt: Date): Promise<string> {
  const id = uuidv7();
  await tracks(h).activities.insertOne({
    _id: id,
    userId,
    uploadId: uuidv7(),
    source: 'upload',
    sport: 'cycling',
    startedAt,
    endedAt: new Date(startedAt.getTime() + 3_600_000),
    elapsedSec: 3600,
    movingSec: 3600,
    distanceM: 8000,
    elevationGainM: null,
    hasHeartRate: false,
    hasPower: false,
    startPoint: { type: 'Point', coordinates: [27.55, 53.9] },
    duplicateOf: null,
    createdAt: h.clock.now(),
  });
  return id;
}

/**
 * Заезд по маршруту прямой вставкой с итогом (сверку проверяет `route-rides`): активность создаётся, если не задана.
 * Возвращает id активности.
 */
export async function seedRouteRide(
  h: Harness,
  userId: string,
  routeId: string,
  startedAt: Date,
  {
    status = 'passed',
    activityId,
  }: { status?: 'passed' | 'not_passed' | 'failed' | 'queued'; activityId?: string } = {},
): Promise<string> {
  const activity = activityId ?? (await seedActivity(h, userId, startedAt));
  const now = h.clock.now();
  const passed = status === 'passed';
  await routeRidesDb(h).rides.insertOne({
    _id: uuidv7(),
    userId,
    routeId,
    activityId: activity,
    activity: {
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3_600_000),
      source: 'upload',
      elapsedSec: 3600,
      distanceM: 8000,
    },
    corridorWidthM: 50,
    status,
    checkRevision: 1,
    checkAttempts: 1,
    reasons: status === 'not_passed' ? ['no_finish'] : [],
    failure: status === 'failed' ? 'error' : null,
    segment: passed
      ? {
          startedAt,
          finishedAt: new Date(startedAt.getTime() + 1_800_000),
          elapsedSec: 1800,
          distanceM: 8000,
          offCorridorM: 0,
          offCorridorShare: 0,
          maxExcursionM: 0,
          coverage: 1,
        }
      : null,
    touchedCorridor: passed ? true : null,
    engineVersion: passed ? 1 : null,
    trackMap: null,
    createdAt: now,
    updatedAt: now,
    checkedAt: passed ? now : null,
  });
  return activity;
}

/**
 * Прошедший райд: создан организатором через API, `goers` отмечаются «Иду», старт сдвинут в прошлое на `daysBack`
 * (создать райд в прошлом API не даёт).
 */
export async function pastRide(
  h: Harness,
  organizer: Rider,
  goers: readonly Rider[],
  daysBack: number,
  title = 'Кофе-райд',
): Promise<string> {
  const ride = await createRide(h, organizer, { title });
  for (const who of goers) {
    const res = await join(h, who, ride.id);
    if (res.status !== 200) throw new Error(`join: ${res.status}`);
  }
  await ridesDb(h).updateOne({ _id: ride.id }, { $set: { startsAt: daysAgo(h, daysBack) } });
  return ride.id;
}

/**
 * `n` гонок «в зачёте» (место 5) по одной в день: первая — `fromDaysAgo` дней назад, следующие — на день позже.
 * Возвращает id гонок по дате.
 */
export async function racesAt(
  h: Harness,
  seasonId: string,
  userId: string,
  n: number,
  fromDaysAgo: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let k = 0; k < n; k += 1) {
    ids.push(await raceAt(h, seasonId, [placedRow(userId, 5)], daysAgo(h, fromDaysAgo - k)));
  }
  return ids;
}
