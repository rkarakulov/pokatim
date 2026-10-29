import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { OgCardMeta } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { seedRace, seedStart, startsDb } from '../../../test/og';
import { routesDb, seedRiderRoute } from '../../../test/routes';
import {
  createRide,
  hideInDb,
  rider,
  seedApprovedRoute,
  seedTeamRoute,
  type Rider,
} from '../../../test/rides';
import { QUEUE } from '../../queues';
import { ROUTE_GEOMETRY, type RouteGeometry } from '../routes';
import { RIDES_FOR_SHARING, type RidesForSharing } from '../rides';
import { OG_CARD_RENDER_JOB, OgCardCache, type OgCardJob } from './og-card.cache';
import { OG_THEME_ID, ogCardHash, ogCardVersion } from './og-card.inputs';
import { OG_CARD_POLICY } from './sharing.policy';
import { StoryCardProcessor } from './story-card.processor';

/**
 * OG-картинки публичных страниц (og-images, AC1, AC2, AC4): версия (`cards`), выдача PNG (`images`), задача
 * `og-card.render` (процессор — напрямую). Redis и MongoDB — настоящие; рендер — настоящие satori + resvg.
 */
let h: Harness;
let organizer: Rider;
let ip = 0;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  ip += 1;
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const get = (url: string, from = `10.9.${ip % 250}.1`) =>
  h.app.inject({ method: 'GET', url: `/v1${url}`, headers: { 'x-forwarded-for': from } });

async function version(kind: string, id: string): Promise<string> {
  const res = await get(`/og/cards/${kind}/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return OgCardMeta.parse(res.json()).version;
}

const image = (kind: string, id: string, v: string) => get(`/og/images/${kind}/${id}/${v}.png`);
const queue = () => h.app.get<Queue>(getQueueToken(QUEUE.storyCard));
const jobs = async () =>
  (await queue().getJobs(['waiting', 'prioritized', 'delayed', 'active'])) as Job<OgCardJob>[];
const processor = () => h.worker.get(StoryCardProcessor);
const ogCache = () => h.app.get(OgCardCache);

/** Все задачи очереди → процессор напрямую (по порядку постановки). */
async function runJobs(): Promise<string[]> {
  const outcomes: string[] = [];
  for (const job of await jobs()) {
    await job.remove();
    outcomes.push(await processor().buildOgCard(job.data));
  }
  return outcomes;
}

/** Публичные объекты всех 4 видов. */
async function seedAll() {
  const routeId = await seedTeamRoute(h);
  return {
    race: await seedRace(h, { corridor: { routeId, widthM: 50, distanceM: 1300 } }),
    ride: (await createRide(h, organizer, { routeId })).id,
    route: routeId,
    calendar: await seedStart(h),
  };
}

describe('cards — версия для SSR (AC1)', () => {
  it('4 вида и бренд → 200 { version } (16 hex), повтор — та же версия', async () => {
    const ids = await seedAll();
    for (const [kind, id] of Object.entries(ids)) {
      const v = await version(kind, id);
      expect(v).toMatch(/^[0-9a-f]{16}$/);
      expect(await version(kind, id)).toBe(v);
    }
    const brand = await get('/og/cards/brand/site');
    expect(brand.statusCode).toBe(200);
    expect(OgCardMeta.parse(brand.json()).version).toMatch(/^[0-9a-f]{16}$/);
    expect(brand.headers['cache-control']).toBe('public, max-age=60');
  });

  it('непубличные и неизвестные → 404; кривые kind/id → 400', async () => {
    const draft = await seedRace(h, { status: 'draft' });
    const cancelled = await seedRace(h, { status: 'cancelled' });
    const hidden = await createRide(h, organizer);
    await hideInDb(h, hidden.id);
    const pending = await seedRiderRoute(h, organizer.userId);
    const unpublished = await seedStart(h, { status: 'unpublished' });
    for (const [kind, id] of [
      ['race', draft],
      ['race', cancelled],
      ['ride', hidden.id],
      ['route', pending],
      ['calendar', unpublished],
      ['race', uuidv7()],
    ] as const) {
      const res = await get(`/og/cards/${kind}/${id}`);
      expect(res.statusCode, `${kind} ${id}`).toBe(404);
      expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
    for (const url of ['/og/cards/season/' + draft, '/og/cards/race/site', '/og/cards/race/x']) {
      expect((await get(url)).statusCode, url).toBe(400);
    }
  });
});

describe('images — выдача PNG (AC2)', () => {
  it('нет PNG → бренд-PNG no-store + задачи своего хэша и бренда с priority; повтор — без новых (NX)', async () => {
    const { race } = await seedAll();
    const v = await version('race', race);
    // нет ни своей, ни бренда — 404 JSON, задачи поставлены
    const first = await image('race', race, v);
    expect(first.statusCode).toBe(404);
    expect(first.headers['content-type']).toContain('application/json');
    expect(first.headers['cache-control']).toBe('no-store');
    const queued = await jobs();
    expect(queued.map((job) => job.data.kind).sort()).toEqual(['brand', 'race']);
    for (const job of queued) {
      expect(job.name).toBe(OG_CARD_RENDER_JOB);
      expect(job.id).toBe(`og-card-${job.data.hash}`);
      expect(job.opts.priority).toBe(OG_CARD_POLICY.jobPriority);
    }
    await image('race', race, v);
    expect(await jobs()).toHaveLength(2);

    // готов только бренд → заглушка 200 no-store
    const brandJob = queued.find((job) => job.data.kind === 'brand')!;
    await brandJob.remove();
    expect(await processor().buildOgCard(brandJob.data)).toBe('ready');
    const fallback = await image('race', race, v);
    expect(fallback.statusCode).toBe(200);
    expect(fallback.headers['content-type']).toBe('image/png');
    expect(fallback.headers['cache-control']).toBe('no-store');

    // своя готова → 200, публичный кэш, 1200×630
    expect(await runJobs()).toEqual(['ready']);
    const ready = await image('race', race, v);
    expect(ready.statusCode).toBe(200);
    expect(ready.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': 'inline; filename="pokatim.png"',
    });
    expect(ready.rawPayload.readUInt32BE(16)).toBe(1200);
    expect(ready.rawPayload.readUInt32BE(20)).toBe(630);
    expect(ready.rawPayload.equals(fallback.rawPayload)).toBe(false);
  });

  it('старая версия → 302 на текущую; кривой file → 400; бренд — тот же поток', async () => {
    const start = await seedStart(h);
    const old = await version('calendar', start);
    await startsDb(h).updateOne({ _id: start }, { $set: { title: 'Новое название' } });
    const current = await version('calendar', start);
    expect(current).not.toBe(old);
    const moved = await image('calendar', start, old);
    expect(moved.statusCode).toBe(302);
    expect(moved.headers.location).toBe(`/v1/og/images/calendar/${start}/${current}.png`);
    expect(moved.headers['cache-control']).toBe('public, max-age=300');
    for (const file of ['ABCDEF0123456789.png', 'abc.png', `${current}.jpg`]) {
      expect((await get(`/og/images/calendar/${start}/${file}`)).statusCode, file).toBe(400);
    }
    expect((await get(`/og/images/brand/site/${old}.png`)).statusCode).toBe(302);
    const brand = OgCardMeta.parse((await get('/og/cards/brand/site')).json()).version;
    const missing = await get(`/og/images/brand/site/${brand}.png`);
    expect(missing.statusCode).toBe(404);
    expect(await runJobs()).toEqual(['ready']);
    const ready = await get(`/og/images/brand/site/${brand}.png`);
    expect(ready.statusCode).toBe(200);
    expect(ready.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('выдача 200 продлевает TTL PNG (вариант A R-A1)', async () => {
    const brand = OgCardMeta.parse((await get('/og/cards/brand/site')).json()).version;
    await get(`/og/images/brand/site/${brand}.png`);
    const [job] = await jobs();
    await runJobs();
    const key = `og:png:${job!.data.hash}`;
    expect(await h.redis.ttl(key)).toBeGreaterThan(OG_CARD_POLICY.pngTtlSec - 10);
    await h.redis.expire(key, 60);
    await get(`/og/images/brand/site/${brand}.png`);
    expect(await h.redis.ttl(key)).toBeGreaterThan(OG_CARD_POLICY.pngTtlSec - 10);
  });

  it('скрыли райд → 404 JSON, не PNG', async () => {
    const ride = await createRide(h, organizer);
    const v = await version('ride', ride.id);
    await image('ride', ride.id, v);
    await runJobs();
    expect((await image('ride', ride.id, v)).statusCode).toBe(200);
    await hideInDb(h, ride.id);
    const hidden = await image('ride', ride.id, v);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.headers['content-type']).toContain('application/json');
    expect((await get(`/og/cards/ride/${ride.id}`)).statusCode).toBe(404);
  });

  it('IP-лимиты og-card и og-image — 429 со своим бакетом', async () => {
    const policy = OG_CARD_POLICY as unknown as {
      cardsIpLimit: { limit: number };
      imageIpLimit: { limit: number };
    };
    const [cards, images] = [policy.cardsIpLimit.limit, policy.imageIpLimit.limit];
    policy.cardsIpLimit.limit = 2;
    policy.imageIpLimit.limit = 2;
    try {
      const statuses = [];
      for (let i = 0; i < 3; i += 1) statuses.push((await get('/og/cards/brand/site')).statusCode);
      expect(statuses).toEqual([200, 200, 429]);
      const v = OgCardMeta.parse((await get('/og/cards/brand/site', '10.8.0.1')).json()).version;
      const images = [];
      for (let i = 0; i < 3; i += 1) {
        images.push((await get(`/og/images/brand/site/${v}.png`)).statusCode);
      }
      expect(images).toEqual([404, 404, 429]);
    } finally {
      policy.cardsIpLimit.limit = cards;
      policy.imageIpLimit.limit = images;
    }
  });
});

describe('приватность (AC4)', () => {
  it('райд со своим (private) маршрутом — версия как без линии; маршрут снят с каталога — новая версия, 302', async () => {
    const own = await seedRiderRoute(h, organizer.userId);
    const privateRide = await createRide(h, organizer, { routeId: own });
    const rides = h.app.get<RidesForSharing>(RIDES_FOR_SHARING);
    const facts = await rides.ogFacts(privateRide.id);
    expect(facts).toMatchObject({ routeId: null });
    // версия HTTP — ровно версия тех же фактов без линии (а не с `routeId` документа)
    const noLine = ogCardVersion(
      ogCardHash({ kind: 'ride', themeId: OG_THEME_ID, facts: { ...facts!, routeId: null } }),
    );
    const withOwnLine = ogCardVersion(
      ogCardHash({ kind: 'ride', themeId: OG_THEME_ID, facts: { ...facts!, routeId: own } }),
    );
    expect(await version('ride', privateRide.id)).toBe(noLine);
    expect(noLine).not.toBe(withOwnLine);

    const team = await seedTeamRoute(h);
    const ride = await createRide(h, organizer, { routeId: team });
    const withLine = await version('ride', ride.id);
    await routesDb(h).routes.updateOne({ _id: team }, { $set: { catalog: null } });
    const withoutLine = await version('ride', ride.id);
    expect(withoutLine).not.toBe(withLine);
    const moved = await image('ride', ride.id, withLine);
    expect(moved.statusCode).toBe(302);
    expect(moved.headers.location).toContain(withoutLine);
  });

  it('ответы cards и задачи — без организатора и автора', async () => {
    const approved = await seedApprovedRoute(h, organizer.userId);
    const ride = await createRide(h, organizer, { organizerName: 'Иван Организатор' });
    for (const [kind, id] of [
      ['ride', ride.id],
      ['route', approved],
    ] as const) {
      const res = await get(`/og/cards/${kind}/${id}`);
      expect(res.body).not.toContain(organizer.userId);
      expect(res.body).not.toContain('Организатор');
      await image(kind, id, OgCardMeta.parse(res.json()).version);
    }
    for (const job of await jobs()) {
      expect(JSON.stringify(job.data)).not.toContain(organizer.userId);
    }
  });
});

describe('buildOgCard — процессор', () => {
  it('готово → og:png:<hash> с TTL политики, pending снят; лог — вид и id без названия', async () => {
    const { calendar } = await seedAll();
    await image('calendar', calendar, await version('calendar', calendar));
    const [job] = (await jobs()).filter((j) => j.data.kind === 'calendar');
    await job!.remove();
    const logs: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    expect(await processor().buildOgCard(job!.data)).toBe('ready');
    vi.restoreAllMocks();
    const ttl = await h.redis.ttl(`og:png:${job!.data.hash}`);
    expect(ttl).toBeGreaterThan(OG_CARD_POLICY.pngTtlSec - 10);
    expect(await h.redis.exists(`og:pending:${job!.data.hash}`)).toBe(0);
    expect(logs.join('\n')).toContain(`og calendar ${calendar}: ready`);
    expect(logs.join('\n')).not.toContain('Гран-фондо');
  });

  it('новая версия объекта вытесняет прежний PNG: в Redis один og:png этого объекта (ревью F1)', async () => {
    const start = await seedStart(h);
    await image('calendar', start, await version('calendar', start));
    await runJobs();
    const first = await h.redis.get(`og:obj:calendar:${start}`);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await startsDb(h).updateOne({ _id: start }, { $set: { title: 'Вторая версия' } });
    await image('calendar', start, await version('calendar', start));
    await runJobs();
    const second = await h.redis.get(`og:obj:calendar:${start}`);
    expect(second).not.toBe(first);
    expect(await h.redis.exists(`og:png:${first}`)).toBe(0);
    expect(await h.redis.exists(`og:png:${second}`)).toBe(1);
    // повтор того же хэша — PNG не удаляется
    await processor().buildOgCard({ kind: 'calendar', id: start, hash: second! });
    expect(await h.redis.exists(`og:png:${second}`)).toBe(1);
  });

  it('TTL: «живой» объект — 7 сут., вне окна пререндера (самолечение) — короткий (ревью F2)', async () => {
    const live = await seedStart(h);
    const old = await seedStart(h, { startsOn: '2025-06-01', endsOn: '2025-06-02' });
    for (const id of [live, old]) await image('calendar', id, await version('calendar', id));
    await runJobs();
    const ttl = async (id: string) =>
      h.redis.ttl(`og:png:${await h.redis.get(`og:obj:calendar:${id}`)}`);
    expect(await ttl(live)).toBeGreaterThan(OG_CARD_POLICY.pngTtlSec - 10);
    expect(await ttl(old)).toBeLessThanOrEqual(OG_CARD_POLICY.pngShortTtlSec);
    expect(await ttl(old)).toBeGreaterThan(OG_CARD_POLICY.pngShortTtlSec - 10);
  });

  it('хэш устарел или объект скрыт → skipped, PNG не пишется', async () => {
    const ride = await createRide(h, organizer);
    await image('ride', ride.id, await version('ride', ride.id));
    const [job] = (await jobs()).filter((j) => j.data.kind === 'ride');
    await hideInDb(h, ride.id);
    expect(await processor().buildOgCard(job!.data)).toBe('skipped');
    expect(await h.redis.exists(`og:png:${job!.data.hash}`)).toBe(0);
    const start = await seedStart(h);
    const stale = { kind: 'calendar' as const, id: start, hash: 'f'.repeat(64) };
    expect(await processor().buildOgCard(stale)).toBe('skipped');
  });

  it('последняя попытка с ошибкой → failed, pending удержан failedHoldSec; лог — только тип ошибки', async () => {
    const routeId = await seedTeamRoute(h);
    const race = await seedRace(h, { corridor: { routeId, widthM: 50, distanceM: 1300 } });
    await image('race', race, await version('race', race));
    const [job] = (await jobs()).filter((j) => j.data.kind === 'race');
    vi.spyOn(h.worker.get<RouteGeometry>(ROUTE_GEOMETRY), 'displayGeometry').mockRejectedValue(
      new TypeError('boom: Минское кольцо'),
    );
    await expect(processor().buildOgCard(job!.data)).rejects.toThrow('boom');
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    expect(await processor().buildOgCard(job!.data, { finalAttempt: true })).toBe('failed');
    const ttl = await h.redis.ttl(`og:pending:${job!.data.hash}`);
    expect(ttl).toBeGreaterThan(OG_CARD_POLICY.failedHoldSec - 10);
    expect(warnings.join('\n')).toContain(`og race ${race}: failed (TypeError)`);
    expect(warnings.join('\n')).not.toContain('Минское кольцо');
    // удержание: следующий запрос заглушки не ставит рендер
    vi.restoreAllMocks();
    expect(await ogCache().claim(job!.data.hash)).toBe(false);
  });

  it('линии: гонка — линия показа коридора, райд с private-маршрутом — inviteLine не вызывается', async () => {
    const routeId = await seedTeamRoute(h);
    const race = await seedRace(h, { corridor: { routeId, widthM: 50, distanceM: 1300 } });
    const own = await seedRiderRoute(h, organizer.userId);
    const ride = await createRide(h, organizer, { routeId: own });
    const display = vi.spyOn(h.worker.get<RouteGeometry>(ROUTE_GEOMETRY), 'displayGeometry');
    const inviteLine = vi.spyOn(h.worker.get<RidesForSharing>(RIDES_FOR_SHARING), 'inviteLine');
    await image('race', race, await version('race', race));
    await image('ride', ride.id, await version('ride', ride.id));
    expect(await runJobs()).toEqual(['ready', 'ready', 'ready']);
    expect(display).toHaveBeenCalledWith(routeId);
    expect(inviteLine).not.toHaveBeenCalled();
  });
});
