import { RideView } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness, MINUTE } from '../../../test/harness';
import { eventsOfType } from '../../../test/notifications';
import {
  authed,
  createRide,
  fieldCodesOf,
  join,
  RIDES,
  rideBody,
  rider,
  ridesDb,
  startsIn,
  type Rider,
} from '../../../test/rides';
import { RIDES_POLICY } from './rides.policy';
import { RidesRepository } from './rides.repository';

/**
 * Создание, правка и отмена кофе-райда организатором (AC1, AC4, AC5, AC-T5): окно времени старта, квота будущих
 * райдов, лимит частоты, оптимистичная `version`, владение (чужой — 404), лимит не ниже идущих, перенос.
 */
let h: Harness;
let organizer: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
});
afterAll(async () => {
  await h.close();
});

describe('создание', () => {
  it('201: организатор — первый участник, version 0, роль organizer, подпись — как введена', async () => {
    const res = await authed(
      h,
      organizer,
      'POST',
      RIDES,
      rideBody(h, { organizerName: 'Катя Л.', limit: 12 }),
    );
    expect(res.status).toBe(201);
    const view = RideView.parse(res.body);
    expect(view.viewer).toEqual({
      role: 'organizer',
      canJoin: false,
      canLeave: false,
      canManage: true,
      reported: false,
      canReport: false,
    });
    expect(view.ride).toMatchObject({
      goingCount: 1,
      limit: 12,
      full: false,
      phase: 'upcoming',
      organizerName: 'Катя Л.',
      version: 0,
      city: 'minsk',
    });
    const doc = await ridesDb(h).findOne({ _id: view.ride.id });
    expect(doc?.participants.map((p) => p.userId)).toEqual([organizer.userId]);
    expect(doc?.goingCount).toBe(1);
    expect(doc?.status).toBe('published');
  });

  it('окно старта: раньше +30 мин — RIDE_START_IN_PAST, дальше +60 дней — RIDE_START_TOO_FAR', async () => {
    const early = await authed(
      h,
      organizer,
      'POST',
      RIDES,
      rideBody(h, { startsAt: startsIn(h, 29 * MINUTE) }),
    );
    expect(early.status).toBe(400);
    expect(fieldCodesOf(early.body)).toEqual([{ path: 'startsAt', code: 'RIDE_START_IN_PAST' }]);
    const far = await authed(
      h,
      organizer,
      'POST',
      RIDES,
      rideBody(h, { startsAt: startsIn(h, 61 * DAY) }),
    );
    expect(fieldCodesOf(far.body)).toEqual([{ path: 'startsAt', code: 'RIDE_START_TOO_FAR' }]);
    expect(await ridesDb(h).countDocuments()).toBe(0);
  });

  it('схема: лишний ключ, темп «от» > «до» — 400 по полям; без входа — 401', async () => {
    const extra = await authed(h, organizer, 'POST', RIDES, {
      ...rideBody(h),
      organizerUserId: 'x',
    });
    expect(extra.status).toBe(400);
    const pace = await authed(
      h,
      organizer,
      'POST',
      RIDES,
      rideBody(h, { paceMinKmh: 30, paceMaxKmh: 20 }),
    );
    expect(fieldCodesOf(pace.body)).toEqual([{ path: 'paceMaxKmh', code: 'RIDE_PACE_ORDER' }]);
    const { app } = h;
    const guest = await app.inject({ method: 'POST', url: RIDES, payload: rideBody(h) });
    expect(guest.statusCode).toBe(401);
  });

  it('квота: шестой будущий райд — 409 RIDE_QUOTA_EXCEEDED с размером; отменённые не считаются', async () => {
    const created = [];
    for (let i = 0; i < RIDES_POLICY.maxUpcomingOrganized; i++) {
      created.push(await createRide(h, organizer));
    }
    const sixth = await authed(h, organizer, 'POST', RIDES, rideBody(h));
    expect(sixth.status).toBe(409);
    expect(sixth.body).toMatchObject({
      code: 'RIDE_QUOTA_EXCEEDED',
      details: { quota: 'organized', limit: 5 },
    });
    await authed(h, organizer, 'POST', `${RIDES}/${created[0]!.id}/cancel`, { reason: 'weather' });
    expect((await authed(h, organizer, 'POST', RIDES, rideBody(h))).status).toBe(201);
  });

  it('лимит частоты rides-create: 429 + Retry-After и retryAfterSec', async () => {
    const limit = RIDES_POLICY.createLimit.limit;
    // квота 5 будущих не мешает: созданные сразу отменяются
    for (let i = 0; i < limit; i++) {
      const ride = await createRide(h, organizer);
      await ridesDb(h).updateOne({ _id: ride.id }, { $set: { status: 'cancelled' } });
    }
    const limited = await authed(h, organizer, 'POST', RIDES, rideBody(h));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
  });
});

describe('правка', () => {
  it('организатор меняет поля по version; неизменённое время старта за 10 минут до старта — можно', async () => {
    const ride = await createRide(h, organizer);
    // до старта 10 минут (часы стенда не двигаются: access живёт 15 минут)
    const soon = startsIn(h, 10 * MINUTE);
    await ridesDb(h).updateOne({ _id: ride.id }, { $set: { startsAt: new Date(soon) } });
    const res = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      startsAt: soon,
      description: 'Новое описание',
      organizerName: 'Катя',
    });
    expect(res.status).toBe(200);
    expect(RideView.parse(res.body).ride).toMatchObject({
      description: 'Новое описание',
      organizerName: 'Катя',
      version: 1,
      rescheduledAt: null,
    });
  });

  it('очистка необязательных полей: null (и пустая строка) — поле очищается, а не пропускается', async () => {
    const ride = await createRide(h, organizer, {
      organizerName: 'Катя Л.',
      description: 'Едем спокойно',
      limit: 12,
    });
    const res = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      organizerName: null,
      description: '  ',
      limit: null,
    });
    expect(res.status).toBe(200);
    expect(RideView.parse(res.body).ride).toMatchObject({
      organizerName: null,
      description: null,
      limit: null,
      version: 1,
    });
    expect(await ridesDb(h).findOne({ _id: ride.id })).toMatchObject({
      organizerName: null,
      description: null,
      limit: null,
    });
  });

  it('устаревшая version — 409 CONFLICT; чужой и неизвестный — 404', async () => {
    const ride = await createRide(h, organizer);
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, { version: 0, title: 'Раз' });
    const stale = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      title: 'Два',
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });

    const stranger = await rider(h, 'stranger@example.by');
    const foreign = await authed(h, stranger, 'POST', `${RIDES}/${ride.id}`, {
      version: 1,
      title: 'Чужой',
    });
    expect(foreign.status).toBe(404);
    const unknown = await authed(
      h,
      organizer,
      'POST',
      `${RIDES}/01890a5d-ac96-774b-bcce-b302099a8057`,
      {
        version: 0,
        title: 'Нет',
      },
    );
    expect(unknown.status).toBe(404);
  });

  it('лимит ниже идущих — 400 поле limit RIDE_LIMIT_BELOW_GOING; равный — можно', async () => {
    const ride = await createRide(h, organizer, { limit: 5 });
    const a = await rider(h, 'a@example.by');
    const b = await rider(h, 'b@example.by');
    await join(h, a, ride.id);
    await join(h, b, ride.id);
    const below = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      limit: 2,
    });
    expect(below.status).toBe(400);
    expect(fieldCodesOf(below.body)).toEqual([{ path: 'limit', code: 'RIDE_LIMIT_BELOW_GOING' }]);
    const equal = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      limit: 3,
    });
    expect(RideView.parse(equal.body).ride).toMatchObject({ limit: 3, full: true });
  });

  it('гонка «правка лимита ↔ запись»: условие goingCount ≤ limit в фильтре той же операции', async () => {
    const ride = await createRide(h, organizer, { limit: 5 });
    const a = await rider(h, 'a@example.by');
    await join(h, a, ride.id);
    // запись проскочила между чтением сервиса и записью правки: документ уже с тремя идущими
    await ridesDb(h).updateOne(
      { _id: ride.id },
      {
        $push: { participants: { userId: 'late', joinedAt: h.clock.now() } },
        $inc: { goingCount: 1 },
      },
    );
    const res = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      limit: 2,
    });
    expect(fieldCodesOf(res.body)).toEqual([{ path: 'limit', code: 'RIDE_LIMIT_BELOW_GOING' }]);
    expect((await ridesDb(h).findOne({ _id: ride.id }))?.limit).toBe(5);
  });

  it('перенос времени или места при других участниках — rescheduledAt; без них — нет', async () => {
    const solo = await createRide(h, organizer);
    // строка с `$` в pipeline-обновлении — значение, не путь поля (`$literal`)
    const soloRes = await authed(h, organizer, 'POST', `${RIDES}/${solo.id}`, {
      version: 0,
      place: '$goingCount',
    });
    expect(RideView.parse(soloRes.body).ride).toMatchObject({
      rescheduledAt: null,
      place: '$goingCount',
    });

    const ride = await createRide(h, organizer);
    await join(h, await rider(h, 'a@example.by'), ride.id);
    const res = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      startsAt: startsIn(h, 2 * DAY),
    });
    expect(RideView.parse(res.body).ride.rescheduledAt).toBe(h.clock.now().toISOString());
  });

  it('гонка «чтение правки ↔ первый участник ↔ перенос»: rescheduledAt по счётчику в момент записи', async () => {
    const ride = await createRide(h, organizer);
    const a = await rider(h, 'a@example.by');
    const repository = h.app.get(RidesRepository, { strict: false });
    const update = repository.update.bind(repository);
    // сервис прочитал райд (идёт только организатор), затем до записи правки записался первый участник
    const spy = vi.spyOn(repository, 'update').mockImplementationOnce(async (...args) => {
      expect((await join(h, a, ride.id)).status).toBe(200);
      return update(...args);
    });
    const res = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      startsAt: startsIn(h, 2 * DAY),
    });
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(RideView.parse(res.body).ride).toMatchObject({
      goingCount: 2,
      rescheduledAt: h.clock.now().toISOString(),
    });
  });

  it('новое время старта проверяется окном; темп с текущим значением — RIDE_PACE_ORDER', async () => {
    const ride = await createRide(h, organizer);
    const early = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      startsAt: startsIn(h, 10 * MINUTE),
    });
    expect(fieldCodesOf(early.body)).toEqual([{ path: 'startsAt', code: 'RIDE_START_IN_PAST' }]);
    const pace = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      paceMinKmh: 30,
    });
    expect(fieldCodesOf(pace.body)).toEqual([{ path: 'paceMaxKmh', code: 'RIDE_PACE_ORDER' }]);
  });

  it('после старта и отменённый — 409 RIDE_INVALID_STATE', async () => {
    const ride = await createRide(h, organizer);
    await ridesDb(h).updateOne(
      { _id: ride.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() - MINUTE) } },
    );
    const past = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      title: 'Поздно',
    });
    expect(past.status).toBe(409);
    expect(past.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });

    const other = await createRide(h, organizer);
    await authed(h, organizer, 'POST', `${RIDES}/${other.id}/cancel`, { reason: 'weather' });
    const cancelled = await authed(h, organizer, 'POST', `${RIDES}/${other.id}`, {
      version: 1,
      title: 'Поздно',
    });
    expect(cancelled.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
  });

  it('участие не меняет version: правка после параллельного «Я иду» проходит', async () => {
    const ride = await createRide(h, organizer);
    const [joined, edited] = await Promise.all([
      join(h, await rider(h, 'a@example.by'), ride.id),
      authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, { version: 0, title: 'Новое' }),
    ]);
    expect(joined.status).toBe(200);
    expect(edited.status).toBe(200);
    const doc = await ridesDb(h).findOne({ _id: ride.id });
    expect(doc).toMatchObject({ version: 1, goingCount: 2, title: 'Новое' });
  });
});

describe('отмена', () => {
  it('с причиной: статус, причина, фаза cancelled; повтор — идемпотентно, причина прежняя', async () => {
    const ride = await createRide(h, organizer);
    const res = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, {
      reason: 'weather',
    });
    expect(res.status).toBe(200);
    expect(RideView.parse(res.body).ride).toMatchObject({
      phase: 'cancelled',
      cancelReason: 'weather',
    });
    const again = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, {
      reason: 'other',
    });
    expect(again.status).toBe(200);
    expect(RideView.parse(again.body).ride.cancelReason).toBe('weather');
  });

  it('без причины и со свободным текстом — 400; чужой — 404; после старта — 409', async () => {
    const ride = await createRide(h, organizer);
    expect((await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, {})).status).toBe(400);
    expect(
      (await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'дождь' }))
        .status,
    ).toBe(400);
    const stranger = await rider(h, 'stranger@example.by');
    expect(
      (await authed(h, stranger, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' }))
        .status,
    ).toBe(404);
    await ridesDb(h).updateOne(
      { _id: ride.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() - MINUTE) } },
    );
    const past = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, {
      reason: 'weather',
    });
    expect(past.status).toBe(409);
    expect(past.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
  });

  it('лимит частоты rides-manage (правка и отмена вместе): 429', async () => {
    const ride = await createRide(h, organizer);
    let version = 0;
    for (let i = 0; i < RIDES_POLICY.manageLimit.limit; i++) {
      const res = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
        version,
        title: `Название ${i}`,
      });
      expect(res.status).toBe(200);
      version += 1;
    }
    const limited = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, {
      reason: 'weather',
    });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('события для уведомлений (notifications, ADR-0017)', () => {
  const payloads = async (type: string) => (await eventsOfType(h, type)).map((e) => e.payload);

  it('отмена — rides.ride-cancelled { rideId, seq }; повторная отмена — без второго события', async () => {
    const ride = await createRide(h, organizer);
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'other' });
    expect(await payloads('rides.ride-cancelled')).toEqual([
      { rideId: ride.id, seq: expect.any(Number) },
    ]);
  });

  it('перенос при участниках — rides.ride-rescheduled; без участников и правка не старта — без события', async () => {
    const solo = await createRide(h, organizer);
    await authed(h, organizer, 'POST', `${RIDES}/${solo.id}`, {
      version: 0,
      startsAt: startsIn(h, 2 * DAY),
    });
    const ride = await createRide(h, organizer);
    await join(h, await rider(h, 'a@example.by'), ride.id);
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 0,
      place: 'Новое место старта',
    });
    // правка названия после переноса в тот же момент часов стенда — не перенос
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, { version: 1, title: 'Новое' });
    expect(await payloads('rides.ride-rescheduled')).toEqual([
      { rideId: ride.id, seq: expect.any(Number) },
    ]);
  });

  it('отказ записи (устаревшая version, после старта) — без события', async () => {
    const ride = await createRide(h, organizer);
    await join(h, await rider(h, 'a@example.by'), ride.id);
    const stale = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: 5,
      startsAt: startsIn(h, 2 * DAY),
    });
    expect(stale.status).toBe(409);
    expect(await payloads('rides.ride-rescheduled')).toEqual([]);
  });
});
