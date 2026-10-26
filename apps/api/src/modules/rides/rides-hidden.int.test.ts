import { RideCities, RidePage, RideView } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import {
  authed,
  createRide,
  hideInDb,
  join,
  leave,
  RIDES,
  rider,
  type Rider,
} from '../../../test/rides';
import { RIDES_POLICY } from './rides.policy';
import { RidesRepository } from './rides.repository';

/**
 * Видимость скрытого райда (05b, AC4, AC5, AC9; 8.1 A4–A6, Q2): публично и в ленте — нет ни у кого; `me` — только
 * организатору (`phase: 'hidden'`, действия выключены); мутации — 404 чужому и участнику, 409 организатору; квота
 * организатора считает скрытый из опубликованного.
 */
let h: Harness;
let organizer: Rider;
let participant: Rider;
let stranger: Rider;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  participant = await rider(h, 'p@example.by');
  stranger = await rider(h, 's@example.by');
});
afterAll(async () => {
  await h.close();
});

async function hiddenRide() {
  const ride = await createRide(h, organizer);
  expect((await join(h, participant, ride.id)).status).toBe(200);
  const restore = await hideInDb(h, ride.id);
  return { ride, restore };
}

const feedIds = async (who: Rider) =>
  RidePage.parse((await authed(h, who, 'GET', RIDES)).body).items.map((item) => item.id);
const cities = async (who: Rider) =>
  RideCities.parse((await authed(h, who, 'GET', `${RIDES}/cities`)).body).cities;

describe('скрытый райд: чтение', () => {
  it('публичная карточка — 404; лента и города — нет ни у кого; после «Вернуть» — как до', async () => {
    const { ride, restore } = await hiddenRide();
    expect((await call(h, 'GET', `${RIDES}/${ride.id}`)).status).toBe(404);
    for (const who of [organizer, participant, stranger]) {
      expect(await feedIds(who)).toEqual([]);
      expect(await cities(who)).toEqual([]);
    }

    await restore();
    const pub = await call(h, 'GET', `${RIDES}/${ride.id}`);
    expect(pub.status).toBe(200);
    for (const key of ['openReportCount', 'lastReportAt', 'hiddenAt', 'hiddenFromStatus']) {
      expect(pub.body).not.toHaveProperty(key);
    }
    for (const who of [organizer, participant, stranger]) {
      expect(await feedIds(who)).toEqual([ride.id]);
      expect(await cities(who)).toEqual(['minsk']);
    }
    expect(
      RideView.parse((await authed(h, participant, 'GET', `${RIDES}/${ride.id}/me`)).body).viewer
        .role,
    ).toBe('participant');
  });

  it('me: участнику и чужому — 404; организатору — phase hidden, всё выключено', async () => {
    const { ride } = await hiddenRide();
    for (const who of [participant, stranger]) {
      expect((await authed(h, who, 'GET', `${RIDES}/${ride.id}/me`)).status).toBe(404);
    }
    const asOrganizer = await authed(h, organizer, 'GET', `${RIDES}/${ride.id}/me`);
    expect(asOrganizer.status).toBe(200);
    const view = RideView.parse(asOrganizer.body);
    expect(view.ride.phase).toBe('hidden');
    expect(view.viewer).toEqual({
      role: 'organizer',
      canJoin: false,
      canLeave: false,
      canManage: false,
      reported: false,
      canReport: false,
    });
  });
});

describe('скрытый райд: мутации (AC9, 8.1 A5)', () => {
  it('«Я иду»: 404 чужому и участнику (без идемпотентного успеха), 409 организатору', async () => {
    const { ride } = await hiddenRide();
    expect((await join(h, stranger, ride.id)).status).toBe(404);
    expect((await join(h, participant, ride.id)).status).toBe(404);
    const own = await join(h, organizer, ride.id);
    expect(own.status).toBe(409);
    expect(own.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
  });

  it('«Я иду» в ветке квоты отметок: 404 участнику, 409 организатору', async () => {
    const { ride } = await hiddenRide();
    const repository = h.app.get(RidesRepository, { strict: false });
    vi.spyOn(repository, 'countUpcomingJoined').mockResolvedValue(RIDES_POLICY.maxUpcomingJoined);
    try {
      expect((await join(h, participant, ride.id)).status).toBe(404);
      expect((await join(h, organizer, ride.id)).body).toMatchObject({
        code: 'RIDE_INVALID_STATE',
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('«Не иду»: 404 участнику и не-участнику, 409 организатору; отметка участника остаётся', async () => {
    const { ride, restore } = await hiddenRide();
    expect((await leave(h, participant, ride.id)).status).toBe(404);
    expect((await leave(h, stranger, ride.id)).status).toBe(404);
    expect((await leave(h, organizer, ride.id)).body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
    await restore();
    const me = RideView.parse((await authed(h, participant, 'GET', `${RIDES}/${ride.id}/me`)).body);
    expect(me.viewer.role).toBe('participant');
    expect(me.ride.goingCount).toBe(2);
  });

  it('правка и отмена: 409 организатору, 404 чужому', async () => {
    const { ride } = await hiddenRide();
    const version = ride.version + 1;
    const update = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version,
      title: 'Новое название',
    });
    expect(update.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
    const cancel = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, {
      reason: 'weather',
    });
    expect(cancel.body).toMatchObject({ code: 'RIDE_INVALID_STATE' });
    expect(
      (await authed(h, stranger, 'POST', `${RIDES}/${ride.id}`, { version, title: 'Чужое' }))
        .status,
    ).toBe(404);
    expect(
      (await authed(h, stranger, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' }))
        .status,
    ).toBe(404);
  });
});

describe('квота организатора и скрытые (8.1 Q2)', () => {
  it('скрытый из опубликованного занимает слот; скрытый из отменённого — нет', async () => {
    const rides = [];
    for (let i = 0; i < RIDES_POLICY.maxUpcomingOrganized; i++) {
      rides.push(await createRide(h, organizer, { title: `Райд ${i + 1}` }));
    }
    await hideInDb(h, rides[0]!.id);
    const over = await authed(h, organizer, 'POST', RIDES, {
      title: 'Шестой',
      organizerName: null,
      startsAt: new Date(h.clock.now().getTime() + 2 * DAY).toISOString().slice(0, 16) + ':00Z',
      cityCode: 'minsk',
      place: 'Парк Победы',
      distanceKm: 40,
      paceMinKmh: 22,
      paceMaxKmh: 24,
      limit: null,
      description: null,
    });
    expect(over.body).toMatchObject({ code: 'RIDE_QUOTA_EXCEEDED' });

    // отменённый, затем скрытый — слот свободен
    expect(
      (await authed(h, organizer, 'POST', `${RIDES}/${rides[1]!.id}/cancel`, { reason: 'weather' }))
        .status,
    ).toBe(200);
    await hideInDb(h, rides[1]!.id);
    expect((await createRide(h, organizer, { title: 'Шестой' })).id).toBeTruthy();
  });
});
