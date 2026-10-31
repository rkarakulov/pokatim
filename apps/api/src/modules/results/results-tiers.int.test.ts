import { rm } from 'node:fs/promises';

import {
  MyRaceEntry,
  PanelRaceStandings,
  RaceFinishersPage,
  RaceResultsPage,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DISPUTE_PROTOCOL_PLANNED, fileDispute, refusal } from '../../../test/disputes';
import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall, panelSession } from '../../../test/panel';
import { racesDb } from '../../../test/races';
import {
  corridorRace,
  enterRace,
  entryUrl,
  myEntry,
  protocolAction,
  raceAdminUrl,
  resultsDb,
  rider,
  seedBest,
  seedVerifiedProfile,
  signIn,
  travelTo,
  UPLOAD_CLOSES,
  verifiedProfilesDb,
  WINDOW,
} from '../../../test/results';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import type { AttemptFlagDoc, RaceAttemptDoc, RaceEntryDoc } from './results.collection';
import { RESULTS_POLICY } from './results.policy';

/**
 * Уровни заявки и группы зачёта (race-results-07, AC1–AC6, AC8, AC9, AC12): матрица заявки, повышение, места по
 * группе, финишёры, «моё участие» = публичная строка, протокол по группам, флаги панели, споры. Новая гонка — схема
 * `gender_age` (её ставит первая заявка). Стенд: «сейчас» — 22.10.2026 (фаза `upcoming`), окно — 24.10–26.10.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const code = (body: unknown) => (body as { code?: string }).code;
const OPEN = new Date('2026-10-25T12:00:00Z');
const profiles = () => verifiedProfilesDb(h);
const parsed = (res: { body: unknown }) => MyRaceEntry.parse(res.body);

/** Райдер с анкетой (`birthYear` → группа на 2026: 1995 — u40, 1980 — 40_49, 1970 — 50p). */
async function verifiedRider(
  email: string,
  values: Parameters<typeof seedVerifiedProfile>[2] = {},
) {
  const r = await rider(h, email);
  await seedVerifiedProfile(h, r.userId, values);
  return r;
}

/** Засчитанная попытка заявки — напрямую в БД (датчики сегмента — как записал бы worker). */
async function seedCountedAttempt(
  entryId: string,
  raceId: string,
  userId: string,
  elapsedSec: number,
  hr: boolean,
) {
  const startedAt = new Date('2026-10-25T06:00:00Z');
  const now = h.clock.now();
  const doc: RaceAttemptDoc = {
    _id: uuidv7(),
    raceId,
    entryId,
    userId,
    activityId: uuidv7(),
    uploadId: uuidv7(),
    activity: { startedAt, source: 'upload', elapsedSec, distanceM: 8000 },
    origin: 'auto',
    status: 'counted',
    matched: true,
    reasons: [],
    failure: null,
    withdrawReason: null,
    segment: {
      startedAt,
      finishedAt: new Date(startedAt.getTime() + elapsedSec * 1000),
      elapsedMs: elapsedSec * 1000,
      elapsedSec,
      distanceM: 8000,
      offCorridorM: 0,
      offCorridorShare: 0,
      maxExcursionM: 0,
      coverage: 1,
      noisePoints: 0,
    },
    touchedCorridor: true,
    candidates: 1,
    diagnostics: null,
    engineVersion: 1,
    trackMap: null,
    sensors: { hr, power: false },
    flags: hr ? [{ code: 'HR_GAPS', metric: 12 }] : [],
    flagsVersion: 1,
    corridor: { routeId: uuidv7(), widthM: 50 },
    checkRevision: 1,
    checkAttempts: 1,
    requeues: 0,
    checkJobId: null,
    createdAt: now,
    updatedAt: now,
    checkedAt: now,
  };
  await resultsDb(h).attempts.insertOne(doc);
}

describe('схема гонки (admitEntry)', () => {
  it('первая заявка новой гонки ставит gender_age; гонка с lockedAt без схемы (окно деплоя, RC-7) — overall', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    expect((await racesDb(h).races.findOne({ _id: raceId }))?.groupScheme).toBeNull();
    const a = await rider(h, 'a@example.com');
    expect(parsed(await enterRace(h, a.auth, raceId)).groupScheme).toBe('gender_age');
    expect((await racesDb(h).races.findOne({ _id: raceId }))?.groupScheme).toBe('gender_age');

    // заявка старого API: lockedAt есть, схемы нет
    await racesDb(h).races.updateOne({ _id: raceId }, { $unset: { groupScheme: '' } });
    await resultsDb(h).entries.deleteMany({});
    const b = await rider(h, 'b@example.com');
    const entry = parsed(await enterRace(h, b.auth, raceId));
    expect(entry.groupScheme).toBe('overall');
    expect(entry.entry).toMatchObject({ tier: 'verified', groupKey: 'overall' });
  });
});

describe('заявка: уровень и группа (AC1–AC4)', () => {
  it('пустое тело — START/overall (gender_age); блок Verified без анкеты; повышение доступно', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const r = await rider(h);
    const res = await enterRace(h, r.auth, raceId);
    expect(res.status).toBe(201);
    const entry = parsed(res);
    expect(entry.entry).toMatchObject({ tier: 'start', groupKey: 'overall' });
    expect(entry.verified).toEqual({ profileReady: false, ownGroup: null, groupOptions: null });
    expect(entry.actions.canUpgrade).toBe(true);
    expect(entry.result).toMatchObject({ group: 'overall', unranked: null });
  });

  it('Verified без анкеты — 409 VERIFIED_PROFILE_REQUIRED (заявки нет); с анкетой — группа по полу и возрасту, пол и год зафиксированы', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const r = await rider(h);
    const refused = await enterRace(h, r.auth, raceId, { tier: 'verified' });
    expect([refused.status, code(refused.body)]).toEqual([409, 'VERIFIED_PROFILE_REQUIRED']);
    expect(await resultsDb(h).entries.countDocuments()).toBe(0);

    await seedVerifiedProfile(h, r.userId, { gender: 'm', birthYear: 1980 });
    const ok = await enterRace(h, r.auth, raceId, { tier: 'verified' });
    expect(ok.status).toBe(201);
    const entry = parsed(ok);
    expect(entry.entry).toMatchObject({ tier: 'verified', groupKey: 'm_40_49' });
    expect(entry.verified).toEqual({
      profileReady: true,
      ownGroup: 'm_40_49',
      groupOptions: ['m_40_49', 'm_u40'],
    });
    expect(entry.actions.canUpgrade).toBe(false);
    const profile = await profiles().findOne({ _id: r.userId });
    expect(profile?.demographicsLockedAt).toEqual(h.clock.now());
    expect(profile?.version).toBe(1);
  });

  it('младшая группа своего пола — ок; старшая, чужой пол, overall — 422 RESULT_GROUP_NOT_ALLOWED', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const young = await verifiedRider('young@example.com', { birthYear: 1980 });
    const res = await enterRace(h, young.auth, raceId, { tier: 'verified', groupKey: 'm_u40' });
    expect(parsed(res).entry?.groupKey).toBe('m_u40');
    const other = await verifiedRider('other@example.com', { birthYear: 1980 });
    for (const groupKey of ['m_50p', 'w_40_49', 'overall'] as const) {
      const refused = await enterRace(h, other.auth, raceId, { tier: 'verified', groupKey });
      expect([refused.status, code(refused.body)]).toEqual([422, 'RESULT_GROUP_NOT_ALLOWED']);
    }
    // отказ откатывает транзакцию: заявки нет, анкета не зафиксирована
    expect(await resultsDb(h).entries.countDocuments({ userId: other.userId })).toBe(0);
    expect((await profiles().findOne({ _id: other.userId }))?.demographicsLockedAt).toBeNull();
  });

  it('повтор без tier — 200 без изменений (RC-2); Verified → START и смена группы — 409 RACE_TIER_LOCKED (RC-3)', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const r = await verifiedRider('r@example.com', { birthYear: 1980 });
    await enterRace(h, r.auth, raceId, { tier: 'verified' });
    const again = await enterRace(h, r.auth, raceId);
    expect(again.status).toBe(200);
    expect(parsed(again).entry).toMatchObject({ tier: 'verified', groupKey: 'm_40_49' });
    const same = await enterRace(h, r.auth, raceId, { tier: 'verified', groupKey: 'm_40_49' });
    expect(same.status).toBe(200);
    for (const body of [
      { tier: 'start' as const },
      { tier: 'verified' as const, groupKey: 'm_u40' as const },
    ]) {
      const refused = await enterRace(h, r.auth, raceId, body);
      expect([refused.status, code(refused.body)]).toEqual([409, 'RACE_TIER_LOCKED']);
    }
  });

  it('схема overall (гонка до 07): пустое тело и start — verified/overall, без блока Verified; группа ≠ overall — 422', async () => {
    const { raceId } = await corridorRace(h);
    const a = await rider(h, 'a@example.com');
    const entry = parsed(await enterRace(h, a.auth, raceId, { tier: 'start' }));
    expect(entry.groupScheme).toBe('overall');
    expect(entry.entry).toMatchObject({ tier: 'verified', groupKey: 'overall' });
    expect(entry.verified).toBeNull();
    expect(entry.actions.canUpgrade).toBe(false);
    const b = await rider(h, 'b@example.com');
    const refused = await enterRace(h, b.auth, raceId, { tier: 'verified', groupKey: 'm_u40' });
    expect([refused.status, code(refused.body)]).toEqual([422, 'RESULT_GROUP_NOT_ALLOWED']);
  });

  it('лишний ключ тела — 400', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const r = await rider(h);
    const res = await enterRace(h, r.auth, raceId, { place: 1 } as never);
    expect(res.status).toBe(400);
  });

  it('повышение START → Verified в открытом окне — лучший результат пересчитан (место с пульсом); после окна — 409', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const r = await verifiedRider('r@example.com', { birthYear: 1995 });
    const start = parsed(await enterRace(h, r.auth, raceId));
    await seedCountedAttempt(start.entry!.id, raceId, r.userId, 3000, false);
    await seedCountedAttempt(start.entry!.id, raceId, r.userId, 3600, true);
    travelTo(h, OPEN);
    const auth = await signIn(h, r.email);
    // START: лучшая засчитанная (без пульса быстрее), места нет
    const upgraded = await enterRace(h, auth, raceId, { tier: 'verified' });
    expect(upgraded.status).toBe(200);
    const entry = parsed(upgraded);
    expect(entry.entry).toMatchObject({ tier: 'verified', groupKey: 'm_u40' });
    expect(entry.result).toMatchObject({
      status: 'provisional',
      elapsedSec: 3600,
      place: 1,
      ranked: 1,
      group: 'm_u40',
      unranked: null,
    });
    expect((await resultsDb(h).entries.findOne({ _id: entry.entry!.id }))?.best).toMatchObject({
      ranked: true,
      flags: [{ code: 'HR_GAPS', metric: 12 }],
    });

    const late = await verifiedRider('late@example.com', { birthYear: 1995 });
    await enterRace(h, late.auth, raceId);
    travelTo(h, new Date(WINDOW.closesAt.getTime() + 60_000));
    const refused = await enterRace(h, await signIn(h, late.email), raceId, { tier: 'verified' });
    expect([refused.status, code(refused.body)]).toEqual([409, 'RACE_TIER_LOCKED']);
  });
});

/**
 * Гонка `gender_age`: 4 Verified `m_u40` (1000, 1100, 1100, 1200 с) и 1 Verified `w_u40` (1500 с) с местами, START и
 * Verified без пульса — финишёры. Часы — в открытом окне.
 */
async function groupRace() {
  const race = await corridorRace(
    h,
    { protocolPlannedAt: DISPUTE_PROTOCOL_PLANNED },
    { scheme: null },
  );
  const riders: Record<
    string,
    { auth: Record<string, string>; userId: string; entryId: string; email: string }
  > = {};
  const seed: [string, 'm' | 'w' | null, number, boolean][] = [
    ['v1', 'm', 1000, true],
    ['v2', 'm', 1100, true],
    ['v3', 'm', 1100, true],
    ['v4', 'm', 1200, true],
    ['w1', 'w', 1500, true],
    ['s1', null, 900, false],
    ['n1', 'm', 950, false],
  ];
  for (const [index, [name, gender, elapsed, ranked]] of seed.entries()) {
    const r = await rider(h, `${name}@example.com`);
    if (gender) await seedVerifiedProfile(h, r.userId, { gender, birthYear: 1995 });
    const res = await enterRace(h, r.auth, race.raceId, gender ? { tier: 'verified' } : {});
    const entryId = parsed(res).entry!.id;
    await seedBest(h, entryId, elapsed, new Date(`2026-10-25T0${index}:00:00Z`), {
      ranked,
      flags: name === 'v4' ? [{ code: 'HR_GAPS', metric: 15 }] : [],
    });
    riders[name] = { ...r, entryId };
  }
  return { ...race, riders };
}

/** Все ключи объекта рекурсивно. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

describe('места по группе и финишёры (AC5, AC9)', () => {
  it('«1, =2, =2, 4» в группе; START и без пульса — в финишёрах без места; «моё участие» = публичная строка', async () => {
    const { raceId, riders } = await groupRace();
    const res = await call(h, 'GET', `/v1/races/${raceId}/results`);
    const page = RaceResultsPage.parse(res.body);
    // по умолчанию — первая непустая группа
    expect(page.group).toBe('m_u40');
    expect(page.groups).toEqual([
      { key: 'm_u40', ranked: 4 },
      { key: 'w_u40', ranked: 1 },
    ]);
    expect(page.finishers).toBe(2);
    expect(page.items.map((row) => [row.entryId, row.place, row.tied])).toEqual([
      [riders.v1!.entryId, 1, false],
      [riders.v2!.entryId, 2, true],
      [riders.v3!.entryId, 2, true],
      [riders.v4!.entryId, 4, false],
    ]);
    const women = RaceResultsPage.parse(
      (await call(h, 'GET', `/v1/races/${raceId}/results?group=w_u40`)).body,
    );
    expect(women.items.map((row) => [row.entryId, row.place])).toEqual([[riders.w1!.entryId, 1]]);

    const mine = await myEntry(h, riders.v3!.auth, raceId);
    const row = page.items.find((item) => item.entryId === riders.v3!.entryId)!;
    expect(mine.result).toMatchObject({
      status: 'provisional',
      place: row.place,
      tied: row.tied,
      ranked: page.ranked,
      group: 'm_u40',
      unranked: null,
    });

    const finishers = RaceFinishersPage.parse(
      (await call(h, 'GET', `/v1/races/${raceId}/finishers`)).body,
    );
    expect(finishers).toEqual({
      total: 2,
      items: [
        {
          entryId: riders.s1!.entryId,
          elapsedSec: 900,
          riderName: null,
          riderNo: expect.any(Number),
          riderPublicId: null,
          riderAvatar: null,
          unranked: 'start',
        },
        {
          entryId: riders.n1!.entryId,
          elapsedSec: 950,
          riderName: null,
          riderNo: expect.any(Number),
          riderPublicId: null,
          riderAvatar: null,
          unranked: 'no_heart_rate',
        },
      ],
      nextCursor: null,
    });
    const start = await myEntry(h, riders.s1!.auth, raceId);
    expect(start.result).toMatchObject({
      status: 'finisher',
      elapsedSec: 900,
      place: null,
      group: 'overall',
      unranked: 'start',
    });
    const noHr = await myEntry(h, riders.n1!.auth, raceId);
    expect(noHr.result).toMatchObject({
      status: 'finisher',
      place: null,
      unranked: 'no_heart_rate',
    });

    // AC9: флаги и датчики — только панель; уровень чужих — не в публичных ответах. Ключи — сырого тела (до `parse`,
    // который отбросил бы лишние ключи)
    const raw = [
      res.body,
      (await call(h, 'GET', `/v1/races/${raceId}/results?group=w_u40`)).body,
      (await call(h, 'GET', `/v1/races/${raceId}/finishers`)).body,
    ];
    for (const body of raw) {
      const keys = keysOf(body);
      expect(keys.has('flags') || keys.has('sensors') || keys.has('tier')).toBe(false);
    }
    const own = await call(h, 'GET', entryUrl(raceId), undefined, riders.v4!.auth);
    expect(own.status).toBe(200);
    const ownKeys = keysOf(own.body);
    expect(ownKeys.has('result')).toBe(true);
    // ни флагов/датчиков, ни значений анкеты (вес, рост, FTP, год рождения)
    for (const key of ['flags', 'sensors', 'weightKg', 'heightCm', 'ftpW', 'birthYear', 'gender']) {
      expect(ownKeys.has(key)).toBe(false);
    }
  });

  it('курсор: строка другой группы — 400; финишёры — постранично, курсор строки с местом — 400', async () => {
    const { raceId } = await groupRace();
    const first = RaceResultsPage.parse(
      (await call(h, 'GET', `/v1/races/${raceId}/results?limit=1`)).body,
    );
    expect(first.nextCursor).not.toBeNull();
    const foreign = await call(
      h,
      'GET',
      `/v1/races/${raceId}/results?group=w_u40&cursor=${first.nextCursor}`,
    );
    expect(foreign.status).toBe(400);
    const next = RaceResultsPage.parse(
      (await call(h, 'GET', `/v1/races/${raceId}/results?limit=1&cursor=${first.nextCursor}`)).body,
    );
    expect(next.items[0]?.place).toBe(2);
    const finishers = RaceFinishersPage.parse(
      (await call(h, 'GET', `/v1/races/${raceId}/finishers?limit=1`)).body,
    );
    expect(finishers.items).toHaveLength(1);
    const rest = RaceFinishersPage.parse(
      (await call(h, 'GET', `/v1/races/${raceId}/finishers?cursor=${finishers.nextCursor}`)).body,
    );
    expect(rest.items.map((item) => item.unranked)).toEqual(['no_heart_rate']);
    expect(
      (await call(h, 'GET', `/v1/races/${raceId}/finishers?cursor=${first.nextCursor}`)).status,
    ).toBe(400);
  });

  it('курсор без group — группа строки курсора: смена группы по умолчанию между страницами не даёт 400', async () => {
    const { raceId } = await corridorRace(
      h,
      { protocolPlannedAt: DISPUTE_PROTOCOL_PLANNED },
      { scheme: null },
    );
    const women: string[] = [];
    for (const [index, name] of ['w1', 'w2'].entries()) {
      const r = await verifiedRider(`${name}@example.com`, { gender: 'w', birthYear: 1995 });
      const entryId = parsed(await enterRace(h, r.auth, raceId, { tier: 'verified' })).entry!.id;
      await seedBest(h, entryId, 1000 + index, new Date('2026-10-25T06:00:00Z'));
      women.push(entryId);
    }
    const first = RaceResultsPage.parse(
      (await call(h, 'GET', `/v1/races/${raceId}/results?limit=1`)).body,
    );
    expect([first.group, first.items.map((row) => row.entryId)]).toEqual(['w_u40', [women[0]]]);
    // между страницами появилась строка m_u40 — группа по умолчанию стала m_u40
    const man = await verifiedRider('m1@example.com', { gender: 'm', birthYear: 1995 });
    const manEntry = parsed(await enterRace(h, man.auth, raceId, { tier: 'verified' })).entry!.id;
    await seedBest(h, manEntry, 900, new Date('2026-10-25T06:00:00Z'));
    const res = await call(h, 'GET', `/v1/races/${raceId}/results?cursor=${first.nextCursor}`);
    expect(res.status).toBe(200);
    const next = RaceResultsPage.parse(res.body);
    expect([next.group, next.items.map((row) => [row.entryId, row.place])]).toEqual([
      'w_u40',
      [[women[1], 2]],
    ]);
  });

  it('гонка gender_age без строк с местом — группа m_u40, пусто (RC-10)', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const page = RaceResultsPage.parse((await call(h, 'GET', `/v1/races/${raceId}/results`)).body);
    expect(page).toMatchObject({ group: 'm_u40', groups: [], items: [], finishers: 0 });
  });
});

describe('протокол по группам (AC6)', () => {
  it('места по группам; START и без пульса — не в снимке, остаются финишёрами; groupKey и flags в строке; DQ-ревизия сохраняет флаги датчиков', async () => {
    const { raceId, riders } = await groupRace();
    travelTo(h, UPLOAD_CLOSES);
    const token = await panelSession(h, 'admin@example.by');
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    const rows = await resultsDb(h)
      .protocolRows.find({ raceId, revision: 1 })
      .sort({ order: 1 })
      .toArray();
    expect(rows.map((row) => [row.order, row.groupKey, row.place, row.tied])).toEqual([
      [0, 'm_u40', 1, false],
      [1, 'm_u40', 2, true],
      [2, 'm_u40', 2, true],
      [3, 'm_u40', 4, false],
      [4, 'w_u40', 1, false],
    ]);
    expect(rows.map((row) => row.entryId)).not.toContain(riders.s1!.entryId);
    expect(rows.map((row) => row.entryId)).not.toContain(riders.n1!.entryId);
    expect(rows.find((row) => row.entryId === riders.v4!.entryId)?.flags).toEqual([
      { code: 'HR_GAPS', metric: 15 },
    ]);

    const page = RaceResultsPage.parse((await call(h, 'GET', `/v1/races/${raceId}/results`)).body);
    expect(page).toMatchObject({ status: 'final', group: 'm_u40', ranked: 4, finishers: 2 });
    expect(page.groups).toEqual([
      { key: 'm_u40', ranked: 4 },
      { key: 'w_u40', ranked: 1 },
    ]);
    const start = await myEntry(h, await signIn(h, riders.s1!.email), raceId);
    expect(start.result).toMatchObject({ status: 'finisher', elapsedSec: 900, unranked: 'start' });

    const dq = await protocolAction(h, token, raceId, '/protocol/disqualify', {
      entryId: riders.v1!.entryId,
      reason: 'Срезка',
    });
    expect(dq.status).toBe(200);
    const revised = await resultsDb(h)
      .protocolRows.find({ raceId, revision: 2 })
      .sort({ order: 1 })
      .toArray();
    expect(revised.map((row) => [row.groupKey, row.place, row.status])).toEqual([
      ['m_u40', 1, 'revised'],
      ['m_u40', 1, 'revised'],
      ['m_u40', 3, 'revised'],
      ['m_u40', null, 'dq'],
      ['w_u40', 1, 'final'],
    ]);
    expect(revised.find((row) => row.entryId === riders.v4!.entryId)?.flags).toEqual([
      { code: 'HR_GAPS', metric: 15 },
    ]);
  });

  it('старая ревизия без groupKey и flags читается как overall', async () => {
    const { raceId } = await corridorRace(h);
    const a = await rider(h, 'a@example.com');
    const entry = parsed(await enterRace(h, a.auth, raceId));
    await seedBest(h, entry.entry!.id, 1000, new Date('2026-10-25T06:00:00Z'));
    travelTo(h, UPLOAD_CLOSES);
    const token = await panelSession(h, 'admin@example.by');
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    await resultsDb(h).protocolRows.updateMany({ raceId }, { $unset: { groupKey: '', flags: '' } });
    const page = RaceResultsPage.parse((await call(h, 'GET', `/v1/races/${raceId}/results`)).body);
    expect(page).toMatchObject({
      group: 'overall',
      ranked: 1,
      groups: [{ key: 'overall', ranked: 1 }],
    });
    expect(page.items.map((row) => row.place)).toEqual([1]);
    const mine = await myEntry(h, await signIn(h, a.email), raceId);
    expect(mine.result).toMatchObject({ status: 'final', place: 1, group: 'overall' });
    const standings = PanelRaceStandings.parse(
      (await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/standings'))).body,
    );
    expect(standings.items[0]).toMatchObject({ groupKey: 'overall', flags: [] });
  });
});

describe('панель: группы и «Требует внимания» (AC8 на живом чтении)', () => {
  it('флаги датчиков и скорости, фильтры group и attention, счётчики attention и finishers', async () => {
    const { raceId, riders } = await groupRace();
    // (б): женщина — абсолютно лучшая при ≥ 5 строках гонки
    await seedBest(h, riders.w1!.entryId, 800, new Date('2026-10-25T05:00:00Z'));
    const token = await panelSession(h, 'admin@example.by');
    const standings = PanelRaceStandings.parse(
      (await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/standings'))).body,
    );
    expect(standings.groupScheme).toBe('gender_age');
    expect(standings.groups).toEqual([
      { key: 'm_u40', ranked: 4 },
      { key: 'w_u40', ranked: 1 },
    ]);
    const byEntry = new Map(standings.items.map((row) => [row.entryId, row]));
    expect(byEntry.get(riders.w1!.entryId)).toMatchObject({
      tier: 'verified',
      groupKey: 'w_u40',
      place: 1,
      flags: [{ code: 'SPEED_CLUSTER_HIGH', metric: 1 }],
    });
    expect(byEntry.get(riders.v4!.entryId)?.flags).toEqual([{ code: 'HR_GAPS', metric: 15 }]);
    expect(byEntry.get(riders.s1!.entryId)).toMatchObject({
      tier: 'start',
      unranked: 'start',
      place: null,
      elapsedSec: 900,
      resultStatus: 'finisher',
    });
    const attention = PanelRaceStandings.parse(
      (await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/standings?attention=true'))).body,
    );
    expect(attention.items.map((row) => row.entryId).sort()).toEqual(
      [riders.v4!.entryId, riders.w1!.entryId].sort(),
    );
    const women = PanelRaceStandings.parse(
      (await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/standings?group=w_u40'))).body,
    );
    expect(women.items.map((row) => row.entryId)).toEqual([riders.w1!.entryId]);
    expect(
      (await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/standings?attention=false'))).status,
    ).toBe(400);
    const summary = await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/results'));
    expect(summary.body).toMatchObject({
      groupScheme: 'gender_age',
      counts: { ranked: 5, attention: 2, finishers: 2 },
    });
  });
});

describe('панель: фильтры и «Требует внимания» за пределом ответа (standingsMax)', () => {
  it('group/attention фильтруют до предела; attention считается по всей гонке; truncated — по отфильтрованному', async () => {
    const { raceId } = await corridorRace(h, {}, { scheme: null });
    const a = await rider(h, 'a@example.com');
    const template = await resultsDb(h).entries.findOne({
      _id: parsed(await enterRace(h, a.auth, raceId)).entry!.id,
    });
    await resultsDb(h).entries.deleteMany({});
    const max = RESULTS_POLICY.standingsMax;
    const base = h.clock.now().getTime();
    const startedAt = new Date('2026-10-25T06:00:00Z');
    const entry = (
      index: number,
      groupKey: RaceEntryDoc['groupKey'],
      tier: 'verified' | 'start',
      elapsedSec: number,
      flags: AttemptFlagDoc[],
    ): RaceEntryDoc => ({
      ...template!,
      _id: uuidv7(),
      userId: uuidv7(),
      groupKey,
      tier,
      best: {
        attemptId: uuidv7(),
        elapsedSec,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + elapsedSec * 1000),
        ranked: tier === 'verified',
        flags,
      },
      summary: { total: 1, pending: 0, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 },
      createdAt: new Date(base + index * 1000),
      updatedAt: new Date(base + index * 1000),
    });
    // `max` мужчин m_u40 (равные времена — без SPEED_CLUSTER_HIGH), затем женщина w_u40 с флагом (за пределом строк
    // с местом) и START-финишёр с флагом (за пределом всех строк)
    const docs = Array.from({ length: max }, (_, index) =>
      entry(index, 'm_u40', 'verified', 1000, []),
    );
    const woman = entry(max, 'w_u40', 'verified', 1500, [{ code: 'HR_GAPS', metric: 20 }]);
    const finisher = entry(max + 1, 'overall', 'start', 900, [{ code: 'HR_GAPS', metric: 30 }]);
    await resultsDb(h).entries.insertMany([...docs, woman, finisher]);

    const token = await panelSession(h, 'admin@example.by');
    const read = async (query: string) => {
      const res = await panelCall(h, token, 'GET', raceAdminUrl(raceId, `/standings${query}`));
      expect(res.status).toBe(200);
      return PanelRaceStandings.parse(res.body);
    };
    const all = await read('');
    expect(all.items).toHaveLength(max);
    expect(all.truncated).toBe(true);
    expect(all.groups).toEqual([
      { key: 'm_u40', ranked: max },
      { key: 'w_u40', ranked: 1 },
    ]);

    const women = await read('?group=w_u40');
    expect(women.truncated).toBe(false);
    expect(women.items.map((row) => [row.entryId, row.place, row.flags])).toEqual([
      [woman._id, 1, [{ code: 'HR_GAPS', metric: 20 }]],
    ]);

    const attention = await read('?attention=true');
    expect(attention.truncated).toBe(false);
    expect(attention.items.map((row) => row.entryId)).toEqual([woman._id, finisher._id]);

    // финишёры — отдельный фильтр до предела: START за пределом всех строк не теряется (07b pass 1)
    const finishers = await read('?finishers=true');
    expect(finishers.truncated).toBe(false);
    expect(finishers.items.map((row) => [row.entryId, row.place, row.unranked])).toEqual([
      [finisher._id, null, 'start'],
    ]);
    const finishersInGroup = await read('?finishers=true&group=m_u40');
    expect(finishersInGroup.items).toEqual([]);

    const summary = await panelCall(h, token, 'GET', raceAdminUrl(raceId, '/results'));
    expect(summary.body).toMatchObject({ counts: { attention: 2, finishers: 1 } });
  });
});

describe('споры: только Verified с местом в той же группе (AC12)', () => {
  it('START и без пульса — not_ranked; цель START/без пульса и другой группы — target_not_counted; разбор показывает флаги цели', async () => {
    const { raceId, riders } = await groupRace();
    travelTo(h, UPLOAD_CLOSES);
    const auth = async (name: string) => signIn(h, riders[name]!.email);
    const body = (target: string) => ({
      targetEntryId: riders[target]!.entryId,
      category: 'other',
    });
    expect(refusal(await fileDispute(h, await auth('s1'), raceId, body('v1')))).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'not_ranked',
    ]);
    expect(refusal(await fileDispute(h, await auth('n1'), raceId, body('v1')))).toEqual([
      409,
      'DISPUTE_ACTION_BLOCKED',
      'not_ranked',
    ]);
    const v2 = await auth('v2');
    for (const target of ['s1', 'n1', 'w1']) {
      expect(refusal(await fileDispute(h, v2, raceId, body(target)))).toEqual([
        409,
        'DISPUTE_ACTION_BLOCKED',
        'target_not_counted',
      ]);
    }
    const filed = await fileDispute(h, v2, raceId, body('v4'));
    expect(filed.status).toBe(201);
    const token = await panelSession(h, 'admin@example.by');
    const id = (filed.body as { id: string }).id;
    const dispute = await panelCall(h, token, 'GET', `/v1/admin/disputes/${id}`);
    expect((dispute.body as { target: unknown }).target).toMatchObject({
      tier: 'verified',
      groupKey: 'm_u40',
      flags: [{ code: 'HR_GAPS', metric: 15 }],
    });
  });
});
