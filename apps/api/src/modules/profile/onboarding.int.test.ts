import { Session } from '@pokatim/contracts';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { bearer, call, signUpSession } from '../../../test/identity';
import { PROFILE_COLLECTIONS, type ProfileDoc } from './profile.collection';
import { ProfileRepository } from './profile.repository';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ CORS_ORIGINS: 'http://localhost:8081' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const STATUS = '/v1/profile/onboarding';
const SURVEY = '/v1/profile/onboarding/survey';
const profiles = () => h.db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles);
const userIdOf = (session: Session) => String(decodeJwt(session.accessToken).sub);

const getStatus = (session: Session) =>
  call(h, 'GET', STATUS, undefined, bearer(session.accessToken));
const submit = (session: Session, body: unknown) =>
  call(h, 'PUT', SURVEY, body, bearer(session.accessToken));

describe('GET/PUT /v1/profile/onboarding (AC3)', () => {
  it('новый пользователь → false; PUT → true; документ: ответы, surveyCompletedAt, updatedAt по CLOCK; no-store', async () => {
    const session = await signUpSession(h);
    const before = await getStatus(session);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ surveyCompleted: false });
    expect(before.headers['cache-control']).toBe('no-store');

    const saved = await submit(session, { reasons: ['races', 'routes'] });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ surveyCompleted: true });
    expect(saved.headers['cache-control']).toBe('no-store');

    expect((await getStatus(session)).body).toEqual({ surveyCompleted: true });
    expect(await profiles().find().toArray()).toEqual([
      {
        _id: userIdOf(session),
        rideReasons: ['races', 'routes'],
        surveyCompletedAt: h.clock.now(),
        updatedAt: h.clock.now(),
      },
    ]);
  });

  it('повтор с другим набором — ответы заменены, surveyCompletedAt прежний, updatedAt новый', async () => {
    const session = await signUpSession(h);
    await submit(session, { reasons: ['races'] });
    const first = h.clock.now();
    h.clock.advance(MINUTE);

    const again = await submit(session, { reasons: ['calendar', 'exploring'] });

    expect(again.body).toEqual({ surveyCompleted: true });
    expect(await profiles().findOne({ _id: userIdOf(session) })).toEqual({
      _id: userIdOf(session),
      rideReasons: ['calendar', 'exploring'],
      surveyCompletedAt: first,
      updatedAt: h.clock.now(),
    });
  });

  it('два параллельных первых PUT → оба 200, документ один', async () => {
    const session = await signUpSession(h);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        submit(session, { reasons: i % 2 ? ['races'] : ['routes'] }),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(Array(8).fill(200));
    expect(await profiles().countDocuments()).toBe(1);
  });

  it('гонка upsert (duplicate key на _id) — один повтор без вставки, 200', async () => {
    const session = await signUpSession(h);
    const repository = h.app.get(ProfileRepository);
    const doc = {
      _id: userIdOf(session),
      rideReasons: ['races' as const],
      surveyCompletedAt: h.clock.now(),
      updatedAt: h.clock.now(),
    };
    // первая попытка проигрывает гонку: документ вставил «другой запрос», своя вставка — настоящий E11000 на _id
    const spy = vi.spyOn(repository, 'upsertSurvey').mockImplementationOnce(async () => {
      await profiles().insertOne(doc);
      await profiles().insertOne(doc);
    });
    h.clock.advance(MINUTE);

    const res = await submit(session, { reasons: ['routes'] });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await profiles().findOne({ _id: userIdOf(session) })).toMatchObject({
      rideReasons: ['routes'],
    });
    spy.mockRestore();
  });

  it('ответ одного пользователя не виден другому; пользователь — только из access', async () => {
    const mine = await signUpSession(h, 'rider@example.com');
    const other = await signUpSession(h, 'other@example.com');
    await submit(mine, { reasons: ['races'] });
    expect((await getStatus(other)).body).toEqual({ surveyCompleted: false });
    // лишний ключ (попытка указать пользователя) — 400 до БД
    const res = await submit(other, { reasons: ['races'], userId: userIdOf(mine) });
    expect(res.status).toBe(400);
  });
});

describe('PUT /v1/profile/onboarding/survey — входные данные', () => {
  it.each([
    ['пустой массив', { reasons: [] }],
    ['неизвестное значение', { reasons: ['other'] }],
    ['повтор', { reasons: ['races', 'races'] }],
    ['не массив', { reasons: 'races' }],
    ['объект-оператор', { reasons: { $ne: null } }],
    ['оператор в элементе', { reasons: [{ $gt: '' }] }],
  ])('%s → 400 VALIDATION_FAILED, документ не создан', async (_name, body) => {
    const session = await signUpSession(h);
    const res = await submit(session, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await profiles().countDocuments()).toBe(0);
  });

  it('без access — 401, документ не создан', async () => {
    const res = await call(h, 'PUT', SURVEY, { reasons: ['races'] });
    expect(res.status).toBe(401);
    expect(await profiles().countDocuments()).toBe(0);
  });
});

describe('CORS preflight (dev web другого origin)', () => {
  it('OPTIONS с Access-Control-Request-Headers: authorization от CORS_ORIGINS — разрешено', async () => {
    const res = await call(h, 'OPTIONS', SURVEY, undefined, {
      origin: 'http://localhost:8081',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'authorization,content-type',
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(String(res.headers['access-control-allow-headers'])).toMatch(/authorization/i);
    expect(String(res.headers['access-control-allow-methods'] ?? '')).toMatch(/PUT/);
  });
});
