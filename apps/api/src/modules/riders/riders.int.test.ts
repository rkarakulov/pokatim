import {
  type Session,
  PublicRiderProfile,
  PublicRiderRacePage,
  RiderStats,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { twoToneImage } from '../../../test/avatars';
import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call, signUpSession } from '../../../test/identity';
import { memberUser, panelCall, panelSession } from '../../../test/panel';
import {
  addRevision,
  dqRow,
  placedRow,
  seedProtocolRace,
  seedSeason,
} from '../../../test/standings';
import { resultsDb } from '../../../test/results';
import { tracks } from '../../../test/tracks';

/** Документ активности стенда (тип — из коллекции `test/tracks`: модуль `tracks` — только через `index.ts`). */
type ActivityDoc = Parameters<ReturnType<typeof tracks>['activities']['insertOne']>[0];

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const userIdOf = (session: Session) => String(decodeJwt(session.accessToken).sub);
const auth = (session: Session) => bearer(session.accessToken);
const patch = (session: Session, body: unknown) =>
  call(h, 'PATCH', '/v1/profile', body, auth(session));

/** Профиль с именем, клубом и согласием через API; `publicId` из ответа. */
async function publicRider(session: Session, name = 'Анна К.'): Promise<string> {
  const res = await patch(session, { publicName: name, showNameInResults: true, club: 'Velo' });
  const publicId = (res.body as { publicId: string | null }).publicId;
  if (!publicId) throw new Error(`нет publicId: ${JSON.stringify(res.body)}`);
  return publicId;
}

/** Активность напрямую в БД (подготовка: суммы считает порт `ActivityTotals`). */
async function seedActivity(
  userId: string,
  distanceM: number,
  elevationGainM: number | null,
  extra: Partial<ActivityDoc> = {},
): Promise<string> {
  const id = uuidv7();
  const at = h.clock.now();
  await tracks(h).activities.insertOne({
    _id: id,
    userId,
    uploadId: uuidv7(),
    source: 'upload',
    sport: 'cycling',
    startedAt: at,
    endedAt: at,
    elapsedSec: 3600,
    movingSec: 3600,
    distanceM,
    elevationGainM,
    hasHeartRate: false,
    hasPower: false,
    startPoint: { type: 'Point', coordinates: [27.55, 53.9] },
    duplicateOf: null,
    createdAt: at,
    ...extra,
  });
  return id;
}

/** Заявка-финишёр без места (START или Verified без пульса) напрямую в БД; `extra` — снятая, DQ по спору. */
async function seedFinisher(
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

const FORBIDDEN_KEYS = ['userId', 'distanceM', 'elevationGainM', 'activities', 'rides'];
/** Все ключи ответа на любой глубине. */
const keysDeep = (value: unknown): string[] =>
  value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)])
    : [];

describe('GET /v1/riders/:publicId (AC5)', () => {
  it('200 с именем, клубом, аватаром и публичной статистикой; без userId, км, набора; кэш 60 с', async () => {
    const session = await signUpSession(h);
    const userId = userIdOf(session);
    const publicId = await publicRider(session);
    const avatar = await h.app.inject({
      method: 'PUT',
      url: '/v1/profile/avatar',
      headers: { 'content-type': 'application/octet-stream', ...auth(session) },
      payload: await twoToneImage('png'),
    });
    const avatarId = (JSON.parse(avatar.body) as { avatar: { id: string } }).avatar.id;
    const season = await seedSeason(h);
    await seedProtocolRace(h, season, [placedRow(userId, 2)]);
    await seedActivity(userId, 42_000, 300);

    const res = await call(h, 'GET', `/v1/riders/${publicId}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(PublicRiderProfile.parse(res.body)).toEqual({
      publicId,
      name: 'Анна К.',
      club: 'Velo',
      avatar: { id: avatarId },
      stats: { races: 1, podiums: 1, bestPlace: 2, finishes: 1 },
    });
    // тест ключей: ровно эти, без userId, км, набора и райдов
    expect(Object.keys(res.body as object).sort()).toEqual(
      ['avatar', 'club', 'name', 'publicId', 'stats'].sort(),
    );
    expect(Object.keys((res.body as { stats: object }).stats).sort()).toEqual(
      ['bestPlace', 'podiums', 'races'].sort(),
    );
    for (const key of FORBIDDEN_KEYS) expect(keysDeep(res.body)).not.toContain(key);
    expect(JSON.stringify(res.body)).not.toContain(userId);
  });

  it('после отзыва согласия, очистки имени, сброса модератором — 404; повторное согласие — та же ссылка', async () => {
    const session = await signUpSession(h);
    const publicId = await publicRider(session);
    const status = async () => (await call(h, 'GET', `/v1/riders/${publicId}`)).status;
    expect(await status()).toBe(200);

    await patch(session, { showNameInResults: false });
    expect(await status()).toBe(404);
    await patch(session, { showNameInResults: true });
    expect(await status()).toBe(200);

    await patch(session, { publicName: null });
    expect(await status()).toBe(404);
    await patch(session, { publicName: 'Анна' });
    expect(await status()).toBe(200);

    await memberUser(h, 'mod@example.by', 'moderator');
    const token = await panelSession(h, 'mod@example.by');
    const reset = await panelCall(
      h,
      token,
      'POST',
      `/v1/admin/profiles/${userIdOf(session)}/name-reset`,
      { reason: 'Оскорбительное имя' },
    );
    expect(reset.status).toBe(200);
    expect(await status()).toBe(404);
  });

  it('неизвестный publicId — 404, мусор — 400; без согласия publicId нет в ответе профиля', async () => {
    expect((await call(h, 'GET', `/v1/riders/${'z'.repeat(43)}`)).status).toBe(404);
    expect((await call(h, 'GET', '/v1/riders/not-a-token')).status).toBe(400);
    const session = await signUpSession(h);
    expect((await patch(session, { publicName: 'Анна' })).body).toMatchObject({ publicId: null });
  });
});

describe('GET /v1/profile/stats (AC6)', () => {
  it('суммы своих основных велозаездов (дубли, other и чужие не входят); места — по текущим ревизиям опубликованных', async () => {
    const session = await signUpSession(h);
    const userId = userIdOf(session);
    const other = await signUpSession(h, 'other@example.com');
    const primary = await seedActivity(userId, 42_400.4, 350.6);
    await seedActivity(userId, 42_400, 350, { duplicateOf: primary });
    await seedActivity(userId, 10_000, null, { sport: 'cycling_indoor' });
    await seedActivity(userId, 5_000, 20, { sport: 'other' });
    await seedActivity(userIdOf(other), 99_000, 999);

    const season = await seedSeason(h);
    await seedProtocolRace(h, season, [placedRow(userId, 1)], { title: 'Первая' });
    await seedProtocolRace(h, season, [placedRow(userId, 4)], { title: 'Четвёртая' });
    await seedProtocolRace(h, season, [dqRow(userId)], { title: 'DQ' });
    // строка выпала из ревизии 2 — не считается
    const dropped = await seedProtocolRace(h, season, [placedRow(userId, 2)], { title: 'Выпала' });
    await addRevision(h, dropped, 2, [placedRow(uuidv7(), 1)]);
    // протокол не опубликован — не считается
    await seedProtocolRace(h, season, [], { protocol: false, title: 'Без протокола' });
    // чужая строка
    await seedProtocolRace(h, season, [placedRow(userIdOf(other), 3)]);
    // финиши без места (rider-links-in-tables): START и Verified без пульса после публикации — да; до публикации,
    // снятая заявка, DQ по спору, чужой — нет
    const startRace = await seedProtocolRace(h, season, [], { title: 'START' });
    await seedFinisher(startRace, userId);
    await seedFinisher(await seedProtocolRace(h, season, [], { title: 'Без пульса' }), userId, {
      tier: 'verified',
    });
    await seedFinisher(await seedProtocolRace(h, season, [], { protocol: false }), userId);
    await seedFinisher(await seedProtocolRace(h, season, []), userId, { status: 'withdrawn' });
    await seedFinisher(await seedProtocolRace(h, season, []), userId, {
      disqualified: { at: h.clock.now(), disputeId: uuidv7() },
    });
    await seedFinisher(startRace, userIdOf(other));

    const res = await call(h, 'GET', '/v1/profile/stats', undefined, auth(session));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const stats = RiderStats.parse(res.body);
    expect(stats).toMatchObject({
      activities: 2,
      distanceM: 52_400,
      elevationGainM: 351,
      races: 2,
      podiums: 1,
      // 2 «в зачёте» + START + без пульса
      finishes: 4,
    });
    expect(stats.bestPlaces.map((best) => [best.race.title, best.place])).toEqual([
      ['Первая', 1],
      ['Четвёртая', 4],
    ]);
  });

  it('пустой профиль — нули; без входа — 401', async () => {
    const session = await signUpSession(h);
    const res = await call(h, 'GET', '/v1/profile/stats', undefined, auth(session));
    expect(res.body).toEqual({
      activities: 0,
      distanceM: 0,
      elevationGainM: 0,
      races: 0,
      podiums: 0,
      finishes: 0,
      bestPlaces: [],
    });
    expect((await call(h, 'GET', '/v1/profile/stats')).status).toBe(401);
  });
});

describe('GET /v1/riders/:publicId/races (AC9)', () => {
  it('только опубликованные протоколы, текущая ревизия; новые сверху; курсор; 404 до курсора', async () => {
    const session = await signUpSession(h);
    const userId = userIdOf(session);
    const publicId = await publicRider(session);
    const season = await seedSeason(h);
    const june = await seedProtocolRace(h, season, [placedRow(userId, 3)], {
      title: 'Июнь',
      windowEndsAt: new Date('2026-06-10T20:59:00Z'),
    });
    h.clock.advance(60_000);
    const july = await seedProtocolRace(h, season, [dqRow(userId)], {
      title: 'Июль',
      windowEndsAt: new Date('2026-07-10T20:59:00Z'),
    });
    const dropped = await seedProtocolRace(h, season, [placedRow(userId, 1)], { title: 'Выпала' });
    await addRevision(h, dropped, 2, [placedRow(uuidv7(), 1)]);
    await seedProtocolRace(h, season, [], { protocol: false });

    const url = `/v1/riders/${publicId}/races`;
    const res = await call(h, 'GET', url);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const page = PublicRiderRacePage.parse(res.body);
    // строки засеяны с startedAt = «сейчас» стенда: позже — июль
    expect(page.items.map((item) => [item.race.id, item.status, item.place])).toEqual([
      [july, 'dq', null],
      [june, 'final', 3],
    ]);
    for (const key of FORBIDDEN_KEYS) expect(keysDeep(res.body)).not.toContain(key);

    const first = PublicRiderRacePage.parse((await call(h, 'GET', `${url}?limit=1`)).body);
    expect(first.items.map((item) => item.race.id)).toEqual([july]);
    // HIGH-1 ревью: курсор публичной истории — только id гонки, без времени заезда
    const decoded = Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8');
    expect(JSON.parse(decoded)).toEqual({ k: 'r', id: july });
    const startedAt = (await resultsDb(h).protocolRows.find({ userId }).toArray()).map((r) =>
      r.startedAt.toISOString(),
    );
    for (const at of startedAt) expect(decoded).not.toContain(at.slice(0, 16));
    expect(decoded).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    const second = PublicRiderRacePage.parse(
      (await call(h, 'GET', `${url}?limit=1&cursor=${first.nextCursor}`)).body,
    );
    expect(second.items.map((item) => item.race.id)).toEqual([june]);
    expect(second.nextCursor).toBeNull();

    expect((await call(h, 'GET', `${url}?cursor=garbage`)).status).toBe(400);
    // курсор с гонкой не из истории райдера — 400
    const foreign = Buffer.from(JSON.stringify({ k: 'r', id: uuidv7() })).toString('base64url');
    expect((await call(h, 'GET', `${url}?cursor=${foreign}`)).status).toBe(400);
    expect((await call(h, 'GET', `/v1/riders/${'z'.repeat(43)}/races?cursor=garbage`)).status).toBe(
      404,
    );
    await patch(session, { showNameInResults: false });
    expect((await call(h, 'GET', url)).status).toBe(404);
  });
});

describe('финиши без места в публичном профиле (rider-links-in-tables)', () => {
  it('профиль — finishes; история — финиш START без места, unranked; «в зачёте» не меняется', async () => {
    const session = await signUpSession(h);
    const userId = userIdOf(session);
    const publicId = await publicRider(session);
    const season = await seedSeason(h);
    const ranked = await seedProtocolRace(h, season, [placedRow(userId, 2)], { title: 'Место' });
    h.clock.advance(60_000);
    const start = await seedProtocolRace(h, season, [], { title: 'START' });
    await seedFinisher(start, userId, { elapsedSec: 4200 });
    await seedFinisher(await seedProtocolRace(h, season, [], { protocol: false }), userId);

    const profile = PublicRiderProfile.parse((await call(h, 'GET', `/v1/riders/${publicId}`)).body);
    expect(profile.stats).toEqual({ races: 1, podiums: 1, bestPlace: 2, finishes: 2 });

    const res = await call(h, 'GET', `/v1/riders/${publicId}/races`);
    expect(res.status).toBe(200);
    const page = PublicRiderRacePage.parse(res.body);
    expect(
      page.items.map((item) => [
        item.race.id,
        item.place,
        item.status,
        item.unranked,
        item.elapsedSec,
      ]),
    ).toEqual([
      [start, null, 'final', 'start', 4200],
      [ranked, 2, 'final', null, 3600],
    ]);
    for (const key of FORBIDDEN_KEYS) expect(keysDeep(res.body)).not.toContain(key);
    const first = PublicRiderRacePage.parse(
      (await call(h, 'GET', `/v1/riders/${publicId}/races?limit=1`)).body,
    );
    const decoded = Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8');
    expect(JSON.parse(decoded)).toEqual({ k: 'r', id: start });
  });
});
