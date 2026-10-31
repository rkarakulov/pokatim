import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { StoryCardStatus } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call } from '../../../test/identity';
import {
  publicationDoc,
  routesDb,
  seedApprovedRiderRoute,
  seedRiderRoute,
} from '../../../test/routes';
import { authed, rider, seedTeamRoute, type Rider } from '../../../test/rides';
import { QUEUE } from '../../queues';
import { ROUTES_FOR_SHARING, type RoutesForSharing } from '../routes';
import { ROUTE_CARD_RENDER_JOB, type RouteCardJob } from './story-card.cache';
import { StoryCardProcessor } from './story-card.processor';

/**
 * Карточка маршрута каталога для сторис (route-story-card, AC1, AC2, AC4): статус (HTTP), задача `route-card.render`
 * (процессор — напрямую), PNG по капабилити-токену. Право — маршрут сейчас в каталоге. Redis и MongoDB — настоящие.
 */
let h: Harness;
let author: Rider;
let viewer: Rider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  author = await rider(h, 'author@example.by');
  viewer = await rider(h, 'viewer@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const ROUTE_TITLE = 'Кольцо команды';
const processor = () => h.worker.get(StoryCardProcessor);
const queue = () => h.app.get<Queue>(getQueueToken(QUEUE.storyCard));
const jobs = () => queue().getJobs(['waiting', 'delayed', 'active']);
const cardUrl = (routeId: string, query = '?template=line') =>
  `/v1/routes/${routeId}/story-card${query}`;

async function status(who: Rider, routeId: string, query?: string) {
  const res = await authed(h, who, 'GET', cardUrl(routeId, query));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return StoryCardStatus.parse(res.body);
}

const image = (file: string) => h.app.inject({ method: 'GET', url: `/v1/story-cards/${file}` });

/** Единственная задача очереди → процессор напрямую. */
async function takeJob(): Promise<Job<RouteCardJob>> {
  const [job] = await jobs();
  expect(job).toBeDefined();
  expect(job!.name).toBe(ROUTE_CARD_RENDER_JOB);
  await job!.remove();
  return job as Job<RouteCardJob>;
}
const runJob = async (options: { finalAttempt?: boolean } = {}) =>
  processor().buildRouteCard((await takeJob()).data, options);

async function readyToken(who: Rider, routeId: string, query?: string): Promise<string> {
  const ready = await status(who, routeId, query);
  if (ready.status !== 'ready') throw new Error(`ожидалась картинка: ${ready.status}`);
  return ready.token;
}

const ports = () => h.worker.get<RoutesForSharing>(ROUTES_FOR_SHARING);

describe('отказы (AC1)', () => {
  it('гость — 401; кривой id, шаблон, лишний ключ — 400; неизвестный — 404', async () => {
    const routeId = await seedTeamRoute(h);
    expect((await call(h, 'GET', cardUrl(routeId))).status).toBe(401);
    for (const query of ['', '?template=foo', '?template=line&theme=chrono']) {
      expect((await authed(h, viewer, 'GET', cardUrl(routeId, query))).status).toBe(400);
    }
    expect((await authed(h, viewer, 'GET', cardUrl('not-a-uuid'))).status).toBe(400);
    const unknown = await authed(h, viewer, 'GET', cardUrl(uuidv7()));
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(await jobs()).toHaveLength(0);
  });

  it('личный (и владельцу), заявка, отклонённый, скрытый модератором, снятый автором — 404 одним ответом', async () => {
    const own = await seedRiderRoute(h, author.userId);
    const routes = [
      own,
      await seedRiderRoute(h, author.userId, { publication: publicationDoc(h, 'pending') }),
      await seedRiderRoute(h, author.userId, { publication: publicationDoc(h, 'rejected') }),
      await seedApprovedRiderRoute(h, author.userId, { status: 'hidden' }),
      await seedApprovedRiderRoute(h, author.userId, { status: 'withdrawn' }),
    ];
    const bodies = new Set<string>();
    for (const routeId of routes) {
      for (const who of [author, viewer]) {
        const res = await authed(h, who, 'GET', cardUrl(routeId));
        expect(res.status, routeId).toBe(404);
        bodies.add(JSON.stringify(res.body));
      }
    }
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).toContain('NOT_FOUND');
    expect(await jobs()).toHaveLength(0);
  });
});

describe('pending → ready → PNG (AC2)', () => {
  it.each(['команды', 'райдера (одобренный)'] as const)(
    'маршрут %s: одна задача; повтор и второй зритель — тот же токен; PNG 1080×1920',
    async (kind) => {
      const routeId =
        kind === 'команды'
          ? await seedTeamRoute(h)
          : await seedApprovedRiderRoute(h, author.userId, { showAuthorName: true });
      expect(await status(viewer, routeId)).toEqual({ status: 'pending' });
      expect(await status(author, routeId)).toEqual({ status: 'pending' });
      const queued = await jobs();
      expect(queued).toHaveLength(1);
      expect(queued[0]!.id).toMatch(/^route-card-[0-9a-f]{64}$/);
      // без APP_WEB_ORIGIN — без адреса приглашения (P6, RC-P6-6): картинка общая для зрителей
      expect((queued[0]!.data as RouteCardJob).address).toBeNull();

      expect(await runJob()).toBe('ready');
      const token = await readyToken(viewer, routeId);
      expect(await readyToken(viewer, routeId)).toBe(token);
      expect(await readyToken(author, routeId)).toBe(token);

      const res = await image(`${token}.png`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      const png = res.rawPayload;
      expect(png.readUInt32BE(16)).toBe(1080);
      expect(png.readUInt32BE(20)).toBe(1920);

      expect(await status(viewer, routeId, '?template=night')).toEqual({ status: 'pending' });
    },
  );

  it('переименование и смена города — новый хэш; задача прежних входов — skipped без PNG (AC4)', async () => {
    const routeId = await seedTeamRoute(h);
    await status(viewer, routeId);
    const stale = await takeJob();
    await routesDb(h).routes.updateOne({ _id: routeId }, { $set: { title: 'Новое название' } });
    expect(await processor().buildRouteCard(stale.data)).toBe('skipped');
    expect(await status(viewer, routeId)).toEqual({ status: 'pending' });
    const renamed = await takeJob();
    expect(renamed.data.hash).not.toBe(stale.data.hash);
    expect(await processor().buildRouteCard(renamed.data)).toBe('ready');
    const first = await readyToken(viewer, routeId);

    await routesDb(h).routes.updateOne({ _id: routeId }, { $set: { 'catalog.city': 'brest' } });
    expect(await status(viewer, routeId)).toEqual({ status: 'pending' });
    expect(await runJob()).toBe('ready');
    expect(await readyToken(viewer, routeId)).not.toBe(first);
  });

  it('тема создателя карточки: разные темы — разные картинки', async () => {
    const routeId = await seedTeamRoute(h);
    const setTheme = await call(
      h,
      'PUT',
      '/v1/profile/theme',
      { themeId: 'atlas' },
      bearer(viewer.token),
    );
    expect(setTheme.status).toBe(200);
    await status(author, routeId);
    expect(await runJob()).toBe('ready');
    const classic = await readyToken(author, routeId);
    expect(await status(viewer, routeId)).toEqual({ status: 'pending' });
    expect(await runJob()).toBe('ready');
    expect(await readyToken(viewer, routeId)).not.toBe(classic);
  });
});

describe('worker (AC4)', () => {
  it('маршрут снят или скрыт после постановки — skipped, PNG не пишется', async () => {
    const team = await seedTeamRoute(h);
    const approved = await seedApprovedRiderRoute(h, author.userId);
    for (const [routeId, change] of [
      [team, { catalog: null }],
      [approved, { 'publication.status': 'hidden' }],
    ] as const) {
      await status(viewer, routeId);
      const job = await takeJob();
      await routesDb(h).routes.updateOne({ _id: routeId }, { $set: change });
      expect(await processor().buildRouteCard(job.data)).toBe('skipped');
      expect((await authed(h, viewer, 'GET', cardUrl(routeId))).status).toBe(404);
    }
  });

  it('линия пропала между чтениями (`ogLine` → null) — skipped', async () => {
    const routeId = await seedTeamRoute(h);
    await status(viewer, routeId);
    const job = await takeJob();
    const line = vi.spyOn(ports(), 'ogLine').mockResolvedValueOnce(null);
    expect(await processor().buildRouteCard(job.data)).toBe('skipped');
    expect(line).toHaveBeenCalledWith(routeId);
    expect(await status(viewer, routeId)).toEqual({ status: 'pending' });
  });

  it('провал на последней попытке → failed один раз; в логе только тип ошибки', async () => {
    const routeId = await seedTeamRoute(h);
    await status(viewer, routeId);
    const job = await takeJob();
    vi.spyOn(ports(), 'ogLine').mockRejectedValueOnce(new Error('boom'));
    await expect(processor().buildRouteCard(job.data)).rejects.toThrow('boom');
    // сообщение рендера может цитировать разметку — в лог только тип ошибки
    vi.spyOn(ports(), 'ogLine').mockRejectedValueOnce(new TypeError(`boom: ${ROUTE_TITLE}`));
    const warnings: string[] = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    expect(await processor().buildRouteCard(job.data, { finalAttempt: true })).toBe('failed');
    vi.restoreAllMocks();
    const warned = warnings.join('\n');
    expect(warned).toContain(`route ${routeId} line: failed (TypeError)`);
    expect(warned).not.toContain(ROUTE_TITLE);
    expect(warned).not.toContain(viewer.userId);
    expect(await status(viewer, routeId)).toEqual({ status: 'failed' });
    expect(await status(viewer, routeId)).toEqual({ status: 'pending' });
  });

  it('логи рендера — без userId, названия и токена', async () => {
    const routeId = await seedTeamRoute(h);
    const logs: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    await status(viewer, routeId);
    await runJob();
    vi.restoreAllMocks();
    const token = await readyToken(viewer, routeId);
    const text = logs.join('\n');
    expect(text).toContain(`route ${routeId} line: ready (route)`);
    for (const secret of [viewer.userId, ROUTE_TITLE, token]) {
      expect(text).not.toContain(secret);
    }
  });
});
