import { Logger } from '@nestjs/common';
import { RidePage, RideView } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, holdTransaction, retried, untilBlocked } from '../../../test/identity';
import {
  authed,
  createRide,
  hideInDb,
  join,
  report,
  RIDES,
  rider,
  ridesDb,
  type Rider,
} from '../../../test/rides';
import { rideReportsCollections } from './ride-reports.collection';
import { RIDES_POLICY } from './rides.policy';
import { RidesRepository } from './rides.repository';

/**
 * Жалоба на райд (05b, AC1, AC2, AC9, AC12): один раз от пользователя, организатор не жалуется, гость — 401, лимит
 * частоты; счётчик открытых жалоб в документе райда — в той же транзакции, запись райда первой (8.1 D2).
 */
let h: Harness;
let organizer: Rider;
let a: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  a = await rider(h, 'a@example.by');
});
afterAll(async () => {
  await h.close();
});

const reportsDb = () => rideReportsCollections(h.db).reports;

describe('жалоба', () => {
  it('200: reported, кнопки нет; запись с причиной и комментарием; счётчик и время в райде', async () => {
    const ride = await createRide(h, organizer);
    const res = await report(h, a, ride.id, { reason: 'offensive', comment: ' Мат в описании ' });
    expect(res.status).toBe(200);
    const view = RideView.parse(res.body);
    expect(view.viewer).toMatchObject({ role: 'none', reported: true, canReport: false });
    expect(view.ride).not.toHaveProperty('version');

    const docs = await reportsDb().find().toArray();
    expect(docs).toEqual([
      {
        _id: expect.any(String),
        rideId: ride.id,
        reporterUserId: a.userId,
        reason: 'offensive',
        comment: 'Мат в описании',
        createdAt: h.clock.now(),
        resolvedAt: null,
        resolution: null,
        resolvedBy: null,
      },
    ]);
    expect(await ridesDb(h).findOne({ _id: ride.id })).toMatchObject({
      openReportCount: 1,
      lastReportAt: h.clock.now(),
      version: 0,
    });
  });

  it('повтор — 200 без второй записи (комментарий не меняется); два райдера — счётчик 2', async () => {
    const ride = await createRide(h, organizer);
    await report(h, a, ride.id, { reason: 'spam' });
    const again = await report(h, a, ride.id, { reason: 'fake', comment: 'другое' });
    expect(again.status).toBe(200);
    expect(RideView.parse(again.body).viewer.reported).toBe(true);
    expect(await reportsDb().countDocuments()).toBe(1);
    expect((await reportsDb().findOne())?.reason).toBe('spam');
    expect((await ridesDb(h).findOne({ _id: ride.id }))?.openReportCount).toBe(1);

    const b = await rider(h, 'b@example.by');
    expect((await report(h, b, ride.id)).status).toBe(200);
    expect((await ridesDb(h).findOne({ _id: ride.id }))?.openReportCount).toBe(2);
  });

  it('участник и прошедший/отменённый райд — можно (фаза любая)', async () => {
    const ride = await createRide(h, organizer);
    await join(h, a, ride.id);
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    const res = await report(h, a, ride.id);
    expect(res.status).toBe(200);
    expect(RideView.parse(res.body).viewer).toMatchObject({ role: 'participant', reported: true });
  });

  it('организатор — 409 RIDE_INVALID_STATE; гость — 401; лишнее поле и чужая причина — 400', async () => {
    const ride = await createRide(h, organizer);
    const own = await report(h, organizer, ride.id);
    expect(own.status).toBe(409);
    expect(own.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
    expect((await call(h, 'POST', `${RIDES}/${ride.id}/reports`, { reason: 'spam' })).status).toBe(
      401,
    );
    expect((await report(h, a, ride.id, { reason: 'spam', userId: a.userId })).status).toBe(400);
    expect((await report(h, a, ride.id, { reason: 'boring' })).status).toBe(400);
    expect((await report(h, a, ride.id, { reason: 'spam', comment: 'x'.repeat(501) })).status).toBe(
      400,
    );
    expect(await reportsDb().countDocuments()).toBe(0);
  });

  it('несуществующий и скрытый (чужому) — 404; организатору скрытого — 409', async () => {
    expect((await report(h, a, '01890a5d-ac96-774b-bcce-b302099a8057')).status).toBe(404);
    const ride = await createRide(h, organizer);
    await hideInDb(h, ride.id);
    expect((await report(h, a, ride.id)).status).toBe(404);
    expect((await report(h, organizer, ride.id)).body).toMatchObject({
      code: 'RIDE_INVALID_STATE',
    });
    expect(await reportsDb().countDocuments()).toBe(0);
  });

  it('лимит rides-report: 21-я за сутки — 429 + retryAfterSec (повторы тоже считаются)', async () => {
    const ride = await createRide(h, organizer);
    for (let i = 0; i < RIDES_POLICY.reportLimit.limit; i++) {
      expect((await report(h, a, ride.id)).status).toBe(200);
    }
    const limited = await report(h, a, ride.id);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
  });

  it('me и лента — reported у карточки; у других — нет', async () => {
    const ride = await createRide(h, organizer);
    await report(h, a, ride.id);
    const me = RideView.parse((await authed(h, a, 'GET', `${RIDES}/${ride.id}/me`)).body);
    expect(me.viewer).toMatchObject({ reported: true, canReport: false });
    const feed = RidePage.parse((await authed(h, a, 'GET', RIDES)).body);
    expect(feed.items[0]?.viewer).toMatchObject({ reported: true, canReport: false });
    const b = await rider(h, 'b@example.by');
    const other = RidePage.parse((await authed(h, b, 'GET', RIDES)).body);
    expect(other.items[0]?.viewer).toMatchObject({ reported: false, canReport: true });
    const joined = RideView.parse((await join(h, a, ride.id)).body);
    expect(joined.viewer).toMatchObject({ role: 'participant', reported: true });
  });

  it('лог: id райда, пользователя и причина — без комментария', async () => {
    const ride = await createRide(h, organizer);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await report(h, a, ride.id, { reason: 'other', comment: 'Секретный комментарий' });
      const lines = log.mock.calls.map((args) => String(args[0]));
      expect(lines).toContain(`rides.reported ride=${ride.id} uid=${a.userId} reason=other`);
      expect(lines.join('\n')).not.toContain('Секретный');
    } finally {
      log.mockRestore();
    }
  });
});

describe('гонка «Скрыть ↔ жалоба» (8.1 D2)', () => {
  it('удерживаемое скрытие (райд записан первым): жалоба повторяется и получает 404, открытых жалоб нет', async () => {
    const ride = await createRide(h, organizer);
    const repository = h.app.get(RidesRepository, { strict: false });
    const spy = vi.spyOn(repository, 'recordReport');
    const now = h.clock.now();
    const held = await holdTransaction(h, async (session) => {
      await ridesDb(h).updateOne(
        { _id: ride.id },
        {
          $set: {
            status: 'hidden',
            hiddenFromStatus: 'published',
            hiddenAt: now,
            openReportCount: 0,
          },
          $inc: { version: 1 },
        },
        { session },
      );
      await reportsDb().updateMany(
        { rideId: ride.id, resolvedAt: null },
        { $set: { resolvedAt: now, resolution: 'hidden', resolvedBy: organizer.userId } },
        { session },
      );
    });
    const pending = report(h, a, ride.id);
    await untilBlocked(pending, retried(spy));
    await held.commit();
    const res = await pending;
    spy.mockRestore();

    expect(res.status).toBe(404);
    expect((await ridesDb(h).findOne({ _id: ride.id }))?.openReportCount).toBe(0);
    expect(await reportsDb().countDocuments({ rideId: ride.id, resolvedAt: null })).toBe(0);
  });
});
