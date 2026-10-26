import type { Session } from '@pokatim/contracts';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { bearer, call, signUpSession } from '../../../test/identity';
import { PROFILE_COLLECTIONS, type ProfileDoc } from './profile.collection';
import { PROFILE_POLICY } from './profile.policy';
import { ProfileRepository } from './profile.repository';
import { RIDER_NAMES, type RiderNameDirectory } from './rider-names.port';

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

const PROFILE = '/v1/profile';
const getProfile = (session: Session) =>
  call(h, 'GET', PROFILE, undefined, bearer(session.accessToken));
const submit = (session: Session, reasons: string[]) =>
  call(h, 'PUT', '/v1/profile/onboarding/survey', { reasons }, bearer(session.accessToken));
const patch = (session: Session, body: unknown) =>
  call(h, 'PATCH', PROFILE, body, bearer(session.accessToken));
const profiles = () => h.db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles);
const userIdOf = (session: Session) => String(decodeJwt(session.accessToken).sub);
const EMPTY = { rideReasons: [], publicName: null, showNameInResults: false };

describe('GET /v1/profile (AC2)', () => {
  it('документа нет → пустой профиль без имени и согласия (AC1), no-store', async () => {
    const session = await signUpSession(h);
    const res = await getProfile(session);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(EMPTY);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('после опроса — ответы своего пользователя в порядке ответа', async () => {
    const session = await signUpSession(h);
    await submit(session, ['calendar', 'races']);
    const res = await getProfile(session);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...EMPTY, rideReasons: ['calendar', 'races'] });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('ответы одного пользователя не видны другому', async () => {
    const mine = await signUpSession(h, 'rider@example.com');
    const other = await signUpSession(h, 'other@example.com');
    await submit(mine, ['routes']);
    expect((await getProfile(other)).body).toEqual(EMPTY);
  });

  it('без access → 401 UNAUTHORIZED', async () => {
    const res = await call(h, 'GET', PROFILE);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('сессия отозвана выходом → 401 UNAUTHORIZED', async () => {
    const session = await signUpSession(h);
    await call(h, 'POST', '/v1/auth/session/sign-out', { refreshToken: session.refreshToken });
    const res = await getProfile(session);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('PATCH /v1/profile — имя и согласие (AC2–AC4)', () => {
  it('имя обрезается, GET отдаёт то же; опрос и шаг устройств не меняются, updatedAt — CLOCK (AC2)', async () => {
    const session = await signUpSession(h);
    await submit(session, ['races']);
    await call(
      h,
      'PUT',
      '/v1/profile/onboarding/devices',
      { outcome: 'later' },
      bearer(session.accessToken),
    );
    const first = h.clock.now();
    h.clock.advance(MINUTE);

    const res = await patch(session, { publicName: '  Анна К. ' });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      rideReasons: ['races'],
      publicName: 'Анна К.',
      showNameInResults: false,
    });
    expect((await getProfile(session)).body).toEqual(res.body);
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual({
      _id: userIdOf(session),
      rideReasons: ['races'],
      surveyCompletedAt: first,
      devicesStepCompletedAt: first,
      publicName: 'Анна К.',
      showNameInResults: false,
      updatedAt: h.clock.now(),
    });
    const onboarding = await call(
      h,
      'GET',
      '/v1/profile/onboarding',
      undefined,
      bearer(session.accessToken),
    );
    expect(onboarding.body).toEqual({ surveyCompleted: true, devicesStepCompleted: true });
  });

  it('документа нет — создаётся без ответа опроса; онбординг не пройден', async () => {
    const session = await signUpSession(h);
    const res = await patch(session, { showNameInResults: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...EMPTY, showNameInResults: true });
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual({
      _id: userIdOf(session),
      rideReasons: [],
      surveyCompletedAt: null,
      publicName: null,
      showNameInResults: true,
      updatedAt: h.clock.now(),
    });
    const onboarding = await call(
      h,
      'GET',
      '/v1/profile/onboarding',
      undefined,
      bearer(session.accessToken),
    );
    expect(onboarding.body).toEqual({ surveyCompleted: false, devicesStepCompleted: false });
  });

  it('частичное обновление: ключа нет — поле не меняется; опрос после PATCH имя не трогает', async () => {
    const session = await signUpSession(h);
    await patch(session, { publicName: 'Анна К.', showNameInResults: true });
    expect((await patch(session, { showNameInResults: false })).body).toMatchObject({
      publicName: 'Анна К.',
      showNameInResults: false,
    });
    expect((await patch(session, { publicName: 'Ян' })).body).toMatchObject({
      publicName: 'Ян',
      showNameInResults: false,
    });
    await submit(session, ['routes']);
    expect((await getProfile(session)).body).toEqual({
      rideReasons: ['routes'],
      publicName: 'Ян',
      showNameInResults: false,
    });
  });

  it.each([
    ['пустая строка', ''],
    ['null', null],
  ])('%s — имя очищено (AC3)', async (_name, publicName) => {
    const session = await signUpSession(h);
    await patch(session, { publicName: 'Анна К.', showNameInResults: true });
    const res = await patch(session, { publicName });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...EMPTY, showNameInResults: true });
    expect(await profiles().findOne({ _id: userIdOf(session) })).toMatchObject({
      publicName: null,
    });
  });

  it.each([
    ['одна буква', 'А', 'TOO_SHORT'],
    ['81 символ', 'я'.repeat(81), 'TOO_LONG'],
    ['перевод строки', 'Анна\nК.', 'INVALID'],
    ['RTL-override', 'Анна‮К.', 'INVALID'],
    ['служебная подпись', 'Участник', 'INVALID'],
  ])(
    '%s → 400 %s по полю publicName, значения в ответе нет (AC3)',
    async (_name, publicName, code) => {
      const session = await signUpSession(h);
      const res = await patch(session, { publicName });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ path: 'publicName', code }] },
      });
      expect(JSON.stringify(res.body)).not.toContain(publicName);
      expect(await profiles().countDocuments()).toBe(0);
    },
  );

  it.each([
    ['пустое тело', {}],
    ['лишний ключ (попытка указать пользователя)', { publicName: 'Анна К.', userId: 'other' }],
    ['оператор вместо имени', { publicName: { $ne: null } }],
    ['не-boolean согласие', { showNameInResults: 'yes' }],
  ])('%s → 400 VALIDATION_FAILED, документ не создан (AC4)', async (_name, body) => {
    const session = await signUpSession(h);
    const res = await patch(session, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await profiles().countDocuments()).toBe(0);
  });

  it('без access → 401, документ не создан (AC4)', async () => {
    const res = await call(h, 'PATCH', PROFILE, { publicName: 'Анна К.' });
    expect(res.status).toBe(401);
    expect(await profiles().countDocuments()).toBe(0);
  });

  it('PATCH одного пользователя не меняет профиль другого', async () => {
    const mine = await signUpSession(h, 'rider@example.com');
    const other = await signUpSession(h, 'other@example.com');
    await patch(mine, { publicName: 'Анна К.', showNameInResults: true });
    expect((await getProfile(other)).body).toEqual(EMPTY);
  });

  it('лимит profile-update: превышение → 429 RATE_LIMITED + retryAfterSec, запись не выполнена (RC-1)', async () => {
    const session = await signUpSession(h);
    for (let i = 0; i < PROFILE_POLICY.updateLimit.limit; i++) {
      expect((await patch(session, { showNameInResults: i % 2 === 0 })).status).toBe(200);
    }
    const before = await profiles().findOne({ _id: userIdOf(session) });
    const limited = await patch(session, { publicName: 'Анна К.' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual(before);
  });

  it('гонка первых upsert (duplicate key на _id) — один повтор, 200', async () => {
    const session = await signUpSession(h);
    const repository = h.app.get(ProfileRepository);
    const doc = {
      _id: userIdOf(session),
      rideReasons: [],
      surveyCompletedAt: null,
      updatedAt: h.clock.now(),
    };
    const spy = vi.spyOn(repository, 'updatePublicName').mockImplementationOnce(async () => {
      // первая попытка проигрывает гонку: документ вставил «другой запрос», своя вставка — E11000 на _id
      await profiles().insertOne(doc);
      await profiles().insertOne(doc);
      throw new Error('вставка выше бросает duplicate key');
    });

    const res = await patch(session, { publicName: 'Анна К.', showNameInResults: true });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.body).toEqual({ ...EMPTY, publicName: 'Анна К.', showNameInResults: true });
    expect(await profiles().countDocuments()).toBe(1);
    spy.mockRestore();
  });
});

describe('RIDER_NAMES — имена для таблиц результатов (P1)', () => {
  const directory = () => h.app.get<RiderNameDirectory>(RIDER_NAMES);

  it('только с именем и согласием; дубли id; чужие и неизвестные — не в карте', async () => {
    const named = await signUpSession(h, 'named@example.com');
    const hidden = await signUpSession(h, 'hidden@example.com');
    const consentOnly = await signUpSession(h, 'consent@example.com');
    const noProfile = await signUpSession(h, 'none@example.com');
    await patch(named, { publicName: 'Анна К.', showNameInResults: true });
    await patch(hidden, { publicName: 'Скрытый', showNameInResults: false });
    await patch(consentOnly, { showNameInResults: true });

    const names = await directory().publicNames([
      userIdOf(named),
      userIdOf(hidden),
      userIdOf(consentOnly),
      userIdOf(noProfile),
      userIdOf(named),
    ]);

    expect(names).toEqual(new Map([[userIdOf(named), 'Анна К.']]));
  });

  it('пустой вход — пустая карта без запроса', async () => {
    const spy = vi.spyOn(h.app.get(ProfileRepository), 'findPublicNames');
    expect(await directory().publicNames([])).toEqual(new Map());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
