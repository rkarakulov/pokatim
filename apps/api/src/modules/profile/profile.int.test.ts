import {
  PUBLIC_NAME_CONSENT_VERSION,
  ROUTE_RIDES_CONSENT_VERSION,
  type Session,
} from '@pokatim/contracts';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { bearer, call, signUpSession } from '../../../test/identity';
import {
  PROFILE_COLLECTIONS,
  type ProfileConsentEventDoc,
  type ProfileDoc,
} from './profile.collection';
import { avatarsDb, fetchAvatar, seedAvatar } from '../../../test/profiles';
import { ProfileErasure } from './profile-erasure';
import { PROFILE_POLICY } from './profile.policy';
import { ProfileRepository } from './profile.repository';
import { RIDER_NAMES, type RiderNameDirectory } from './rider-names.port';
import { RIDER_THEMES, type RiderThemes } from './rider-themes.port';

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
const consentEvents = () =>
  h.db.collection<ProfileConsentEventDoc>(PROFILE_COLLECTIONS.consentEvents);
const userIdOf = (session: Session) => String(decodeJwt(session.accessToken).sub);
const EMPTY = {
  rideReasons: [],
  publicName: null,
  showNameInResults: false,
  club: null,
  avatar: null,
  publicId: null,
  themeId: 'classic',
  avatarUploadBlockedUntil: null,
  showRouteRides: false,
};
const PUBLIC_ID = expect.stringMatching(/^[A-Za-z0-9_-]{43}$/);

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
      ...EMPTY,
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
      club: null,
      publicId: null,
      showRouteRides: false,
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
      club: null,
      publicId: null,
      showRouteRides: false,
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
    expect((await getProfile(session)).body).toMatchObject({
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
    expect(res.body).toEqual({
      ...EMPTY,
      publicName: 'Анна К.',
      showNameInResults: true,
      publicId: PUBLIC_ID,
    });
    expect(await profiles().countDocuments()).toBe(1);
    expect(await consentEvents().countDocuments({ action: 'granted' })).toBe(1);
    spy.mockRestore();
  });
});

describe('PATCH /v1/profile — клуб и publicId (rider-profile, AC4/AC5)', () => {
  it('клуб обрезается, null и "" очищают; валидация как у имени; ответ содержит club', async () => {
    const session = await signUpSession(h);
    const set = await patch(session, { club: '  Velo Club Minsk ' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ club: 'Velo Club Minsk', publicName: null });
    expect((await getProfile(session)).body).toMatchObject({ club: 'Velo Club Minsk' });
    // имя без ключа club — клуб не меняется
    expect((await patch(session, { publicName: 'Анна К.' })).body).toMatchObject({
      club: 'Velo Club Minsk',
    });
    const invalid = await patch(session, { club: 'Участник' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [{ path: 'club', code: 'INVALID' }] },
    });
    expect((await patch(session, { club: 'V' })).status).toBe(400);
    expect((await patch(session, { club: 'Velo\nClub' })).status).toBe(400);
    expect((await patch(session, { club: null })).body).toMatchObject({ club: null });
    await patch(session, { club: 'Velo' });
    expect((await patch(session, { club: '' })).body).toMatchObject({ club: null });
  });

  it('publicId — только при имени и согласии; стабилен при отзыве и повторном согласии', async () => {
    const session = await signUpSession(h);
    expect((await patch(session, { publicName: 'Анна К.' })).body).toMatchObject({
      publicId: null,
    });
    const granted = await patch(session, { showNameInResults: true });
    expect(granted.body).toMatchObject({ publicId: PUBLIC_ID });
    const publicId = (granted.body as { publicId: string }).publicId;

    expect((await patch(session, { showNameInResults: false })).body).toMatchObject({
      publicId: null,
    });
    expect((await patch(session, { showNameInResults: true })).body).toMatchObject({ publicId });
    expect((await patch(session, { publicName: null })).body).toMatchObject({ publicId: null });
    expect((await patch(session, { publicName: 'Анна' })).body).toMatchObject({ publicId });
    expect(await profiles().findOne({ _id: userIdOf(session) })).toMatchObject({ publicId });
  });

  it('согласие без имени — publicId не выдаётся и не создаётся', async () => {
    const session = await signUpSession(h);
    expect((await patch(session, { showNameInResults: true })).body).toMatchObject({
      publicId: null,
    });
    expect(await profiles().findOne({ _id: userIdOf(session) })).toMatchObject({ publicId: null });
  });
});

describe('PATCH /v1/profile — журнал согласий (profile-02, AC1/AC2)', () => {
  it('false → true: одно событие granted с версией и временем сервера; повтор true — без событий; false — revoked (AC1)', async () => {
    const session = await signUpSession(h);
    const userId = userIdOf(session);

    expect((await patch(session, { showNameInResults: true })).status).toBe(200);
    const granted = await consentEvents().find().toArray();
    expect(granted).toEqual([
      {
        _id: expect.any(String),
        userId,
        kind: 'public_name',
        action: 'granted',
        version: PUBLIC_NAME_CONSENT_VERSION,
        at: h.clock.now(),
      },
    ]);

    h.clock.advance(MINUTE);
    expect((await patch(session, { showNameInResults: true })).status).toBe(200);
    expect(await consentEvents().countDocuments()).toBe(1);

    h.clock.advance(MINUTE);
    expect((await patch(session, { showNameInResults: false })).status).toBe(200);
    const events = await consentEvents()
      .find({}, { sort: { at: 1 } })
      .toArray();
    expect(events.map(({ action, at }) => ({ action, at }))).toEqual([
      { action: 'granted', at: granted[0]?.at },
      { action: 'revoked', at: h.clock.now() },
    ]);
  });

  it('первый false без документа — не событие; true вместе с именем — одно событие без имени', async () => {
    const off = await signUpSession(h, 'off@example.com');
    expect((await patch(off, { showNameInResults: false })).status).toBe(200);
    expect(await consentEvents().countDocuments()).toBe(0);

    const on = await signUpSession(h, 'on@example.com');
    const res = await patch(on, { publicName: 'Анна К.', showNameInResults: true });
    expect(res.body).toMatchObject({ publicName: 'Анна К.', showNameInResults: true });
    const events = await consentEvents().find().toArray();
    expect(events).toHaveLength(1);
    expect(events[0]?.userId).toBe(userIdOf(on));
    expect(JSON.stringify(events)).not.toContain('Анна');
  });

  it('только имя — событий нет (AC2)', async () => {
    const session = await signUpSession(h);
    await patch(session, { publicName: 'Анна К.' });
    await patch(session, { publicName: 'Ян' });
    expect(await consentEvents().countDocuments()).toBe(0);
  });

  it('сбой записи события — откат: флаг и имя прежние, событий нет (AC2)', async () => {
    const session = await signUpSession(h);
    await patch(session, { publicName: 'Анна К.' });
    const before = await profiles().findOne({ _id: userIdOf(session) });
    const spy = vi
      .spyOn(h.app.get(ProfileRepository), 'insertConsentEvent')
      .mockRejectedValueOnce(new Error('сбой записи журнала'));

    const res = await patch(session, { publicName: 'Ян', showNameInResults: true });

    expect(res.status).toBe(500);
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual(before);
    expect(await consentEvents().countDocuments()).toBe(0);
    spy.mockRestore();
  });

  it('гонка двух PATCH true от false — ровно одно granted (чтение прежнего флага в транзакции)', async () => {
    const session = await signUpSession(h);
    await patch(session, { showNameInResults: false });
    const results = await Promise.all([
      patch(session, { showNameInResults: true }),
      patch(session, { showNameInResults: true }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(await consentEvents().countDocuments({ action: 'granted' })).toBe(1);
  });
});

describe('PATCH /v1/profile — показ заездов в таблицах маршрутов (route-rides-04, O1)', () => {
  const routeRidesEvents = () => consentEvents().find({ kind: 'route_rides' }, { sort: { at: 1 } });

  it('включение — granted с версией и временем сервера; повтор — без событий; выключение — revoked', async () => {
    const session = await signUpSession(h);
    const userId = userIdOf(session);
    expect((await getProfile(session)).body).toMatchObject({ showRouteRides: false });

    const on = await patch(session, { showRouteRides: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ showRouteRides: true, showNameInResults: false });
    expect(await consentEvents().find().toArray()).toEqual([
      {
        _id: expect.any(String),
        userId,
        kind: 'route_rides',
        action: 'granted',
        version: ROUTE_RIDES_CONSENT_VERSION,
        at: h.clock.now(),
      },
    ]);

    h.clock.advance(MINUTE);
    expect((await patch(session, { showRouteRides: true })).status).toBe(200);
    expect(await consentEvents().countDocuments()).toBe(1);

    h.clock.advance(MINUTE);
    const off = await patch(session, { showRouteRides: false });
    expect(off.body).toMatchObject({ showRouteRides: false });
    const events = await routeRidesEvents().toArray();
    expect(events.map(({ action, at }) => ({ action, at }))).toEqual([
      { action: 'granted', at: expect.any(Date) },
      { action: 'revoked', at: h.clock.now() },
    ]);
    expect((await getProfile(session)).body).toMatchObject({ showRouteRides: false });
  });

  it('оба флага одним PATCH — два события (public_name, route_rides) в одной транзакции', async () => {
    const session = await signUpSession(h);
    const res = await patch(session, { showNameInResults: true, showRouteRides: true });
    expect(res.body).toMatchObject({ showNameInResults: true, showRouteRides: true });
    const events = await consentEvents().find().toArray();
    expect(events.map(({ kind, action, version }) => ({ kind, action, version }))).toEqual([
      { kind: 'public_name', action: 'granted', version: PUBLIC_NAME_CONSENT_VERSION },
      { kind: 'route_rides', action: 'granted', version: ROUTE_RIDES_CONSENT_VERSION },
    ]);

    // сбой второго события откатывает и первое, и оба флага
    const before = await profiles().findOne({ _id: userIdOf(session) });
    const insert = h.app
      .get(ProfileRepository)
      .insertConsentEvent.bind(h.app.get(ProfileRepository));
    const spy = vi
      .spyOn(h.app.get(ProfileRepository), 'insertConsentEvent')
      .mockImplementationOnce(insert)
      .mockRejectedValueOnce(new Error('сбой записи журнала'));
    const failed = await patch(session, { showNameInResults: false, showRouteRides: false });
    expect(failed.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual(before);
    expect(await consentEvents().countDocuments()).toBe(2);
    spy.mockRestore();
  });

  it('PATCH без ключа (старый клиент) — флаг сохранён; опрос и тема не стирают его', async () => {
    const session = await signUpSession(h);
    await patch(session, { showRouteRides: true });
    expect((await patch(session, { publicName: 'Анна К.' })).body).toMatchObject({
      publicName: 'Анна К.',
      showRouteRides: true,
    });
    await submit(session, ['routes']);
    const theme = await call(
      h,
      'PUT',
      '/v1/profile/theme',
      { themeId: 'atlas' },
      bearer(session.accessToken),
    );
    expect(theme.body).toMatchObject({ showRouteRides: true });
    expect(await consentEvents().countDocuments({ kind: 'route_rides' })).toBe(1);
  });

  it('старый документ без поля — false; не-boolean — 400 INVALID, события нет', async () => {
    const session = await signUpSession(h);
    await patch(session, { publicName: 'Анна К.' });
    await profiles().updateOne({ _id: userIdOf(session) }, { $unset: { showRouteRides: '' } });
    expect((await getProfile(session)).body).toMatchObject({ showRouteRides: false });
    const bad = await patch(session, { showRouteRides: 'yes' });
    expect(bad.status).toBe(400);
    expect(await consentEvents().countDocuments()).toBe(0);
  });

  it('показ заездов не делает профиль публичным: publicId не выдаётся', async () => {
    const session = await signUpSession(h);
    const res = await patch(session, { publicName: 'Анна К.', showRouteRides: true });
    expect(res.body).toMatchObject({ publicId: null, showNameInResults: false });
    expect((await profiles().findOne({ _id: userIdOf(session) }))?.publicId).toBeNull();
  });
});

describe('PATCH /v1/profile — перевыпуск id фото (profile-moderation, RC-A2 (b), AC8)', () => {
  /** Публичный профиль с фото: сессия, userId и посеянное фото. */
  async function publicWithAvatar() {
    const session = await signUpSession(h);
    expect(
      (await patch(session, { publicName: 'Анна', showNameInResults: true, club: 'Velo' })).status,
    ).toBe(200);
    const userId = userIdOf(session);
    return { session, userId, avatar: await seedAvatar(h, userId) };
  }
  const avatarIdIn = (body: unknown) => (body as { avatar: { id: string } | null }).avatar?.id;

  it.each([
    ['отзыв согласия', { showNameInResults: false }],
    ['очистка имени', { publicName: null }],
  ])(
    '%s — старый id 404, новый avatar.id отдаёт те же байты; один документ фото',
    async (_n, body) => {
      const { session, userId, avatar } = await publicWithAvatar();
      const res = await patch(session, body);
      expect(res.status).toBe(200);
      const newId = avatarIdIn(res.body);
      expect(newId).toEqual(expect.any(String));
      expect(newId).not.toBe(avatar.id);
      expect(avatarIdIn((await getProfile(session)).body)).toBe(newId);
      expect((await fetchAvatar(h, avatar.id)).status).toBe(404);
      const fetched = await fetchAvatar(h, newId as string);
      expect(fetched.status).toBe(200);
      expect(Buffer.compare(fetched.raw, avatar.bytes)).toBe(0);
      expect(await avatarsDb(h).countDocuments({ userId })).toBe(1);
    },
  );

  it('включение согласия, смена клуба и имени при согласии — id тот же', async () => {
    const { session, avatar } = await publicWithAvatar();
    for (const body of [{ club: 'Другой клуб' }, { publicName: 'Анна К.' }]) {
      expect(avatarIdIn((await patch(session, body)).body)).toBe(avatar.id);
    }
    const hidden = await signUpSession(h, 'hidden@example.com');
    expect((await patch(hidden, { publicName: 'Борис' })).status).toBe(200);
    const hiddenAvatar = await seedAvatar(h, userIdOf(hidden));
    expect(avatarIdIn((await patch(hidden, { showNameInResults: true })).body)).toBe(
      hiddenAvatar.id,
    );
    expect((await fetchAvatar(h, avatar.id)).status).toBe(200);
  });

  it('непубличный → непубличный (смена имени без согласия) — id тот же', async () => {
    const session = await signUpSession(h);
    expect((await patch(session, { publicName: 'Вера' })).status).toBe(200);
    const avatar = await seedAvatar(h, userIdOf(session));
    expect(avatarIdIn((await patch(session, { publicName: null })).body)).toBe(avatar.id);
    expect((await fetchAvatar(h, avatar.id)).status).toBe(200);
  });

  it('без фото — отзыв согласия не создаёт фото', async () => {
    const session = await signUpSession(h);
    await patch(session, { publicName: 'Анна', showNameInResults: true });
    const res = await patch(session, { showNameInResults: false });
    expect((res.body as { avatar: unknown }).avatar).toBeNull();
    expect(await avatarsDb(h).countDocuments({ userId: userIdOf(session) })).toBe(0);
  });
});

describe('PUT /v1/profile/theme — личная тема (user-theme, AC2/AC7)', () => {
  const setTheme = (session: Session, body: unknown) =>
    call(h, 'PUT', '/v1/profile/theme', body, bearer(session.accessToken));

  it('без access → 401, документ не создан', async () => {
    const res = await call(h, 'PUT', '/v1/profile/theme', { themeId: 'atlas' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await profiles().countDocuments()).toBe(0);
  });

  it.each([
    ['незнакомый id', { themeId: 'neon' }],
    ['лишний ключ', { themeId: 'atlas', decor: 'none' }],
    ['оператор', { themeId: { $ne: null } }],
    ['пусто', {}],
  ])('%s → 400, документ не создан', async (_n, body) => {
    const session = await signUpSession(h);
    const res = await setTheme(session, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await profiles().countDocuments()).toBe(0);
  });

  it('без выбора — classic; выбор — 200 с ProfileView, no-store, GET отдаёт выбранную', async () => {
    const session = await signUpSession(h);
    expect((await getProfile(session)).body).toEqual(EMPTY);

    const res = await setTheme(session, { themeId: 'atlas' });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ ...EMPTY, themeId: 'atlas' });
    expect((await getProfile(session)).body).toEqual(res.body);
    expect((await setTheme(session, { themeId: 'classic' })).body).toEqual(EMPTY);
  });

  it('документа нет — создаётся без ответа опроса; онбординг не пройден, согласий нет', async () => {
    const session = await signUpSession(h);
    expect((await setTheme(session, { themeId: 'chrono' })).status).toBe(200);
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual({
      _id: userIdOf(session),
      rideReasons: [],
      surveyCompletedAt: null,
      publicName: null,
      showNameInResults: false,
      club: null,
      publicId: null,
      showRouteRides: false,
      themeId: 'chrono',
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
    expect(await consentEvents().countDocuments()).toBe(0);
  });

  it('не трогает имя, согласие, клуб, аватар, publicId; журнал согласий не пишется; PATCH тему не стирает', async () => {
    const session = await signUpSession(h);
    await submit(session, ['races']);
    await patch(session, { publicName: 'Анна К.', showNameInResults: true, club: 'Velo' });
    const avatar = await seedAvatar(h, userIdOf(session));
    const before = await profiles().findOne({ _id: userIdOf(session) });
    const events = await consentEvents().countDocuments();
    h.clock.advance(MINUTE);

    const res = await setTheme(session, { themeId: 'journal' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      rideReasons: ['races'],
      publicName: 'Анна К.',
      showNameInResults: true,
      club: 'Velo',
      avatar: { id: avatar.id },
      publicId: PUBLIC_ID,
      themeId: 'journal',
    });
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual({
      ...before,
      themeId: 'journal',
      updatedAt: h.clock.now(),
    });
    expect(await consentEvents().countDocuments()).toBe(events);

    await patch(session, { club: 'Velo 2' });
    expect((await getProfile(session)).body).toMatchObject({ club: 'Velo 2', themeId: 'journal' });
  });

  it('тема одного пользователя не видна другому', async () => {
    const mine = await signUpSession(h, 'rider@example.com');
    const other = await signUpSession(h, 'other@example.com');
    await setTheme(mine, { themeId: 'atlas' });
    expect((await getProfile(other)).body).toEqual(EMPTY);
  });

  it('два первых PUT одновременно — оба 200, один документ', async () => {
    const session = await signUpSession(h);
    const results = await Promise.all([
      setTheme(session, { themeId: 'atlas' }),
      setTheme(session, { themeId: 'chrono' }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    expect(await profiles().countDocuments()).toBe(1);
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
    const spy = vi.spyOn(repository, 'setTheme').mockImplementationOnce(async () => {
      await profiles().insertOne(doc);
      await profiles().insertOne(doc);
      throw new Error('вставка выше бросает duplicate key');
    });

    const res = await setTheme(session, { themeId: 'planner' });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.body).toEqual({ ...EMPTY, themeId: 'planner' });
    expect(await profiles().countDocuments()).toBe(1);
    spy.mockRestore();
  });

  it('лимит profile-theme: превышение → 429 + retryAfterSec, запись не выполнена; PATCH не лимитирован (RC-3)', async () => {
    const session = await signUpSession(h);
    for (let i = 0; i < PROFILE_POLICY.themeUpdateLimit.limit; i++) {
      const themeId = i % 2 === 0 ? 'atlas' : 'chrono';
      expect((await setTheme(session, { themeId })).status).toBe(200);
    }
    const before = await profiles().findOne({ _id: userIdOf(session) });
    const limited = await setTheme(session, { themeId: 'journal' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual(before);
    expect((await patch(session, { publicName: 'Анна К.' })).status).toBe(200);
  });

  it('после стирания профиля (ProfileErasure) — classic', async () => {
    const session = await signUpSession(h);
    await setTheme(session, { themeId: 'atlas' });
    await h.app.get(ProfileErasure).erase(userIdOf(session));
    expect((await getProfile(session)).body).toEqual(EMPTY);
  });
});

describe('RIDER_THEMES — тема создателя карточки (user-theme, A5)', () => {
  const themes = () => h.app.get<RiderThemes>(RIDER_THEMES);

  it('нет документа или поля — classic; выбранная — как есть', async () => {
    const chosen = await signUpSession(h, 'chosen@example.com');
    const fresh = await signUpSession(h, 'fresh@example.com');
    const named = await signUpSession(h, 'named@example.com');
    await call(h, 'PUT', '/v1/profile/theme', { themeId: 'atlas' }, bearer(chosen.accessToken));
    await patch(named, { publicName: 'Анна К.' });

    expect(await themes().themeOf(userIdOf(chosen))).toBe('atlas');
    expect(await themes().themeOf(userIdOf(fresh))).toBe('classic');
    expect(await themes().themeOf(userIdOf(named))).toBe('classic');
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
