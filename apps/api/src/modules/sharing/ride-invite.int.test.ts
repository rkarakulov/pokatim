import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { StoryCardStatus } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { routesDb, seedRiderRoute } from '../../../test/routes';
import {
  authed,
  createRide,
  hideInDb,
  RIDES,
  rider,
  ridesDb,
  seedApprovedRoute,
  seedTeamRoute,
  type Rider,
} from '../../../test/rides';
import { QUEUE } from '../../queues';
import { RIDE_ROUTES, type RideRoutes } from '../routes';
import { RIDES_FOR_SHARING, type RidesForSharing } from '../rides';
import { RIDE_INVITE_RENDER_JOB, type RideInviteJob } from './story-card.cache';
import { StoryCardProcessor } from './story-card.processor';

/**
 * Карточка-приглашение кофе-райда (ride-invite-card, AC1–AC4): статус (HTTP), задача `ride-invite.render` (процессор —
 * напрямую), PNG по капабилити-токену; линия — только маршрута каталога. Redis и MongoDB — настоящие.
 */
let h: Harness;
let organizer: Rider;
let other: Rider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  other = await rider(h, 'other@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const processor = () => h.worker.get(StoryCardProcessor);
const queue = () => h.app.get<Queue>(getQueueToken(QUEUE.storyCard));
const jobs = () => queue().getJobs(['waiting', 'delayed', 'active']);
const cardUrl = (rideId: string, query = '?template=line') =>
  `${RIDES}/${rideId}/invite-card${query}`;

async function status(who: Rider, rideId: string, query?: string) {
  const res = await authed(h, who, 'GET', cardUrl(rideId, query));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return StoryCardStatus.parse(res.body);
}

const image = (file: string) => h.app.inject({ method: 'GET', url: `/v1/story-cards/${file}` });

/** Единственная задача очереди → процессор напрямую. */
async function takeJob(): Promise<Job<RideInviteJob>> {
  const [job] = await jobs();
  expect(job).toBeDefined();
  expect(job!.name).toBe(RIDE_INVITE_RENDER_JOB);
  await job!.remove();
  return job as Job<RideInviteJob>;
}
const runJob = async (options: { finalAttempt?: boolean } = {}) =>
  processor().buildRideInvite((await takeJob()).data, options);

async function readyToken(who: Rider, rideId: string, query?: string): Promise<string> {
  const ready = await status(who, rideId, query);
  if (ready.status !== 'ready') throw new Error(`ожидалась картинка: ${ready.status}`);
  return ready.token;
}

/** Линия, которую процессор отдал рендеру (`inviteLine` порта `rides`). */
function spyLine() {
  const rides = h.worker.get<RidesForSharing>(RIDES_FOR_SHARING);
  return vi.spyOn(rides, 'inviteLine');
}

describe('отказы (AC1)', () => {
  it('гость — 401; кривой id, шаблон, лишний ключ — 400; неизвестный — 404', async () => {
    const ride = await createRide(h, organizer);
    expect((await call(h, 'GET', cardUrl(ride.id))).status).toBe(401);
    for (const query of ['', '?template=foo', '?template=line&theme=chrono']) {
      expect((await authed(h, other, 'GET', cardUrl(ride.id, query))).status).toBe(400);
    }
    expect((await authed(h, other, 'GET', cardUrl('not-a-uuid'))).status).toBe(400);
    const unknown = await authed(h, other, 'GET', cardUrl(uuidv7()));
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('скрытый — 404 всем, и организатору; без задачи', async () => {
    const ride = await createRide(h, organizer);
    await hideInDb(h, ride.id);
    for (const who of [organizer, other]) {
      const res = await authed(h, who, 'GET', cardUrl(ride.id));
      expect(res.status).toBe(404);
    }
    expect(await jobs()).toHaveLength(0);
  });

  it('отменённый и прошедший — 409 STORY_CARD_UNAVAILABLE', async () => {
    const cancelled = await createRide(h, organizer);
    const cancel = await authed(h, organizer, 'POST', `${RIDES}/${cancelled.id}/cancel`, {
      reason: 'weather',
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const past = await createRide(h, organizer);
    h.clock.advance(2 * DAY);
    // access прежних сессий истёк — свежий вход
    const viewer = await rider(h, 'late@example.by');
    for (const id of [cancelled.id, past.id]) {
      const res = await authed(h, viewer, 'GET', cardUrl(id));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'STORY_CARD_UNAVAILABLE' });
    }
    expect(await jobs()).toHaveLength(0);
  });
});

describe('pending → ready → PNG (AC2)', () => {
  it('одна задача; картинка общая для всех зрителей; PNG 1080×1920; другой шаблон — своя', async () => {
    const ride = await createRide(h, organizer);
    expect(await status(other, ride.id)).toEqual({ status: 'pending' });
    expect(await status(organizer, ride.id)).toEqual({ status: 'pending' });
    expect(await jobs()).toHaveLength(1);

    expect(await runJob()).toBe('ready');
    const token = await readyToken(other, ride.id);
    expect(await readyToken(organizer, ride.id)).toBe(token);

    const res = await image(`${token}.png`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    const png = res.rawPayload;
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);

    expect(await status(other, ride.id, '?template=night')).toEqual({ status: 'pending' });
  });

  it('правка райда — новый хэш; задача прежних входов — skipped без PNG (AC4)', async () => {
    const ride = await createRide(h, organizer);
    await status(other, ride.id);
    const stale = await takeJob();
    const edit = await authed(h, organizer, 'POST', `${RIDES}/${ride.id}`, {
      version: ride.version,
      place: 'Новое место',
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(await processor().buildRideInvite(stale.data)).toBe('skipped');
    expect(await status(other, ride.id)).toEqual({ status: 'pending' });
    expect(await runJob()).toBe('ready');
  });

  it('райд скрыт между постановкой и рендером — skipped, без ретрая', async () => {
    const ride = await createRide(h, organizer);
    await status(other, ride.id);
    const job = await takeJob();
    await hideInDb(h, ride.id);
    expect(await processor().buildRideInvite(job.data)).toBe('skipped');
  });

  it('провал на последней попытке → failed один раз, затем новая постановка', async () => {
    const ride = await createRide(h, organizer);
    await status(other, ride.id);
    const job = await takeJob();
    const rides = h.worker.get<RidesForSharing>(RIDES_FOR_SHARING);
    vi.spyOn(rides, 'inviteFacts').mockRejectedValueOnce(new Error('boom'));
    await expect(processor().buildRideInvite(job.data)).rejects.toThrow('boom');
    vi.spyOn(rides, 'inviteFacts').mockRejectedValueOnce(new Error('boom'));
    expect(await processor().buildRideInvite(job.data, { finalAttempt: true })).toBe('failed');
    vi.restoreAllMocks();
    expect(await status(other, ride.id)).toEqual({ status: 'failed' });
    expect(await status(other, ride.id)).toEqual({ status: 'pending' });
  });

  it('логи рендера — без userId, названия, места и токена', async () => {
    const ride = await createRide(h, organizer);
    const logs: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    await status(other, ride.id);
    await runJob();
    vi.restoreAllMocks();
    const token = await readyToken(other, ride.id);
    const text = logs.join('\n');
    expect(text).toContain(`ride ${ride.id} line: ready (no line)`);
    for (const secret of [other.userId, organizer.userId, ride.title, ride.place, token]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('линия — только маршрут каталога (AC3)', () => {
  it('маршрут команды и одобренный маршрут райдера — линия есть', async () => {
    for (const routeId of [await seedTeamRoute(h), await seedApprovedRoute(h, other.userId)]) {
      const ride = await createRide(h, organizer, { routeId });
      const line = spyLine();
      await status(other, ride.id);
      expect(await runJob()).toBe('ready');
      expect(line).toHaveBeenCalledWith(routeId);
      expect((await line.mock.results[0]!.value)?.length).toBeGreaterThanOrEqual(2);
      line.mockRestore();
    }
  });

  it('свой маршрут организатора (private) — линии нет и у организатора', async () => {
    const routeId = await seedRiderRoute(h, organizer.userId);
    const ride = await createRide(h, organizer, { routeId });
    const line = spyLine();
    await status(organizer, ride.id);
    expect(await runJob()).toBe('ready');
    expect(line).not.toHaveBeenCalled();
    const ports = h.worker.get<RideRoutes>(RIDE_ROUTES);
    expect(await ports.catalogLine(routeId)).toBeNull();
  });

  it('маршрут снят с каталога — новый хэш, линии нет; catalogLine снятого — null', async () => {
    const routeId = await seedTeamRoute(h);
    const ride = await createRide(h, organizer, { routeId });
    await status(other, ride.id);
    await runJob();
    const first = await readyToken(other, ride.id);

    await routesDb(h).routes.updateOne({ _id: routeId }, { $set: { catalog: null } });
    const ports = h.worker.get<RideRoutes>(RIDE_ROUTES);
    expect(await ports.catalogLine(routeId)).toBeNull();
    const line = spyLine();
    expect(await status(other, ride.id)).toEqual({ status: 'pending' });
    expect(await runJob()).toBe('ready');
    expect(line).not.toHaveBeenCalled();
    expect(await readyToken(other, ride.id)).not.toBe(first);
    expect((await ridesDb(h).findOne({ _id: ride.id }))?.routeId).toBe(routeId);
  });
});
