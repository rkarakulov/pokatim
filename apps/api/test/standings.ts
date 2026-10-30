import type { BikeClass, GroupScheme, ProtocolRowStatus, ResultGroupKey } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { PROFILE_COLLECTIONS, type ProfileDoc } from '../src/modules/profile/profile.collection';
import { StandingsRecalc } from '../src/modules/standings/standings-recalc';
import { standingsCollections } from '../src/modules/standings/standings.collection';
import type { Harness } from './harness';
import { racesDb } from './races';
import { resultsDb } from './results';

/** Коллекции модуля `standings` тестовой БД. */
export const standingsDb = (h: Harness) => standingsCollections(h.db);

/** Пересчёт рейтинга worker стенда (тот же экземпляр, что у процессора регламента). */
export const standingsRecalc = (h: Harness) => h.worker.get(StandingsRecalc, { strict: false });

/** Прогон регламента `standings.sync`. */
export const syncStandings = (h: Harness) => standingsRecalc(h).sync();

/** Сезон напрямую в БД (подготовка: сезоны и протоколы проверяют `races`/`results`). */
export async function seedSeason(h: Harness, name = 'Сезон 2026'): Promise<string> {
  const id = uuidv7();
  const now = h.clock.now();
  await racesDb(h).seasons.insertOne({
    _id: id,
    name,
    startsOn: '2026-04-01',
    endsOn: '2026-10-31',
    startsAt: new Date('2026-03-31T21:00:00Z'),
    endsBefore: new Date('2026-10-31T21:00:00Z'),
    createdAt: now,
    updatedAt: now,
    version: 0,
  });
  return id;
}

export interface SeedRow {
  userId: string;
  place?: number | null;
  tied?: boolean;
  status?: ProtocolRowStatus;
  /** `undefined` — строка ревизии до race-results-07 (без группы, `overall`) */
  groupKey?: ResultGroupKey;
}

/** Строка с местом / DQ протокола. */
export const placedRow = (
  userId: string,
  place: number,
  groupKey: ResultGroupKey = 'm_u40',
  tied = false,
): SeedRow => ({ userId, place, tied, groupKey });
export const dqRow = (userId: string, groupKey: ResultGroupKey = 'm_u40'): SeedRow => ({
  userId,
  place: null,
  status: 'dq',
  groupKey,
});

/**
 * Опубликованная гонка сезона с протоколом — напрямую в БД (как после публикации `results`): документ гонки с
 * `protocolPublishedAt`, журнал ревизий 1…`revision` и строки текущей ревизии. `groupScheme: null` — гонка без
 * заявок (RC-2); `protocol: false` — без протокола.
 */
export async function seedProtocolRace(
  h: Harness,
  seasonId: string,
  rows: readonly SeedRow[],
  {
    bikeClass = 'road',
    groupScheme = 'gender_age',
    windowEndsAt = new Date('2026-06-01T20:59:00Z'),
    title = 'Гонка',
    revision = 1,
    protocol = true,
    recalculations = true,
  }: {
    bikeClass?: BikeClass;
    groupScheme?: GroupScheme | null;
    windowEndsAt?: Date;
    title?: string;
    revision?: number;
    protocol?: boolean;
    /** `false` — протокол без записей журнала (гонка без ревизии, быть не должно) */
    recalculations?: boolean;
  } = {},
): Promise<string> {
  const id = uuidv7();
  const now = h.clock.now();
  await racesDb(h).races.insertOne({
    _id: id,
    ownerUserId: uuidv7(),
    status: 'published',
    title,
    bikeClass,
    surfaces: ['asphalt'],
    distanceKm: 42.5,
    description: null,
    windowStartsAt: new Date(windowEndsAt.getTime() - 3 * 86_400_000),
    windowEndsAt,
    protocolPlannedAt: new Date(windowEndsAt.getTime() + 2 * 86_400_000),
    seasonId,
    cancelReason: null,
    corridor: null,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    cancelledAt: null,
    lockedAt: groupScheme === null ? null : now,
    groupScheme,
    protocolPublishedAt: protocol ? now : null,
    disputeFilingClosedAt: null,
    version: 1,
  });
  if (protocol && recalculations) {
    for (let r = 1; r <= revision; r += 1) await addRevision(h, id, r, r === revision ? rows : []);
  }
  return id;
}

/** Новая ревизия протокола гонки (DQ, перепроверка): запись журнала и строки ревизии. */
export async function addRevision(
  h: Harness,
  raceId: string,
  revision: number,
  rows: readonly SeedRow[],
): Promise<void> {
  const now = h.clock.now();
  await resultsDb(h).recalculations.insertOne({
    _id: uuidv7(),
    raceId,
    kind: revision === 1 ? 'published' : 'disqualified',
    entryId: null,
    revision,
    reason: 'Протокол',
    actorUserId: uuidv7(),
    at: now,
  });
  if (rows.length === 0) return;
  await resultsDb(h).protocolRows.insertMany(
    rows.map((row, order) => ({
      _id: uuidv7(),
      raceId,
      revision,
      order,
      entryId: uuidv7(),
      userId: row.userId,
      attemptId: uuidv7(),
      elapsedSec: 3600 + order,
      startedAt: now,
      place: row.place ?? null,
      tied: row.tied ?? false,
      status: row.status ?? (revision === 1 ? 'final' : 'revised'),
      ...(row.groupKey ? { groupKey: row.groupKey } : {}),
      createdAt: now,
    })),
  );
}

/** Коллекция профилей — для тестов других модулей (модуль `profile` наружу коллекцию не отдаёт). */
export const profilesCollection = (h: Harness) =>
  h.db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles);

/** Профиль с публичным именем и согласием — напрямую в БД (правила имени проверяет `profile`). */
export async function seedProfile(
  h: Harness,
  userId: string,
  publicName: string | null,
  showNameInResults: boolean,
  /** ссылка на профиль и фото (rider-links-in-tables) */
  extra: { publicId?: string; avatarId?: string } = {},
): Promise<void> {
  await h.db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles).insertOne({
    _id: userId,
    rideReasons: [],
    surveyCompletedAt: null,
    publicName,
    showNameInResults,
    ...extra,
    updatedAt: h.clock.now(),
  });
}

/** Заявка-финишёр без места (START или Verified без пульса) напрямую в БД; `extra` — снятая, DQ по спору. */
export async function seedFinisher(
  h: Harness,
  raceId: string,
  userId: string,
  {
    tier = 'start',
    elapsedSec = 4000,
    ...extra
  }: {
    tier?: 'start' | 'verified';
    elapsedSec?: number;
    status?: 'active' | 'withdrawn';
    disqualified?: { at: Date; disputeId: string } | null;
  } = {},
): Promise<void> {
  const now = h.clock.now();
  await resultsDb(h).entries.insertOne({
    _id: uuidv7(),
    raceId,
    userId,
    status: 'active',
    groupKey: 'overall',
    tier,
    requests: [],
    best: {
      attemptId: uuidv7(),
      elapsedSec,
      startedAt: now,
      finishedAt: now,
      ranked: false,
    },
    summary: { total: 1, pending: 0, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 },
    createdAt: now,
    updatedAt: now,
    withdrawnAt: null,
    disqualified: null,
    version: 1,
    ...extra,
  });
}
