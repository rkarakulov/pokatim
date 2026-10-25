import {
  CurrentSeasonResponse,
  RaceDetail,
  RacePage,
  type RaceStatus,
  type BikeClass,
} from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, HOUR, MINUTE, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { racesDb } from '../../../test/races';
import type { RaceDoc } from './races.collection';
import { seasonRange } from './seasons.service';

/**
 * Публичное чтение гонок и сезона (AC8): без входа, только опубликованные и отменённые, фильтры (ИЛИ внутри, И
 * между), курсор без дублей и пропусков на 45 гонках, схемы контракта, без служебных полей, кэш, инъекции, 429.
 * Стенд: «сейчас» — 22.10.2026 12:00 Минска (09:00 UTC).
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

let ipCounter = 0;
/** Публичный GET с отдельного IP (лимит не делится между проверками). */
const get = (url: string, ip = `203.0.113.${(ipCounter++ % 200) + 1}`) =>
  call(h, 'GET', url, undefined, { 'x-forwarded-for': ip });

const CLASSES: BikeClass[] = ['road', 'tt', 'gravel', 'mtb'];

/** 45 гонок напрямую в БД: окна от 30 дней назад до 60 дней вперёд, шаг 2 дня; черновики, отменённые. */
async function seed() {
  const now = h.clock.now();
  const seasonId = uuidv7();
  await racesDb(h).seasons.insertOne({
    _id: seasonId,
    name: 'Сезон 2026',
    startsOn: '2026-04-01',
    endsOn: '2027-03-31',
    ...seasonRange('2026-04-01', '2027-03-31'),
    createdAt: now,
    updatedAt: now,
    version: 0,
  });
  const docs: RaceDoc[] = Array.from({ length: 45 }, (_, i) => {
    const windowStartsAt = new Date(now.getTime() - 30 * DAY + i * 2 * DAY + (i % 3) * HOUR);
    const windowEndsAt = new Date(windowStartsAt.getTime() + 3 * DAY);
    const status: RaceStatus = i % 9 === 4 ? 'draft' : i % 7 === 3 ? 'cancelled' : 'published';
    return {
      _id: uuidv7(),
      ownerUserId: uuidv7(),
      status,
      title: `Гонка ${i}`,
      bikeClass: CLASSES[i % 4]!,
      surfaces: ['asphalt'],
      distanceKm: 40 + i,
      description: `Описание ${i}`,
      windowStartsAt,
      windowEndsAt,
      protocolPlannedAt: new Date(windowEndsAt.getTime() + 3 * DAY),
      seasonId: status === 'draft' ? null : seasonId,
      cancelReason: status === 'cancelled' ? 'weather' : null,
      createdAt: now,
      updatedAt: now,
      publishedAt: status === 'draft' ? null : now,
      cancelledAt: status === 'cancelled' ? now : null,
      version: 3,
    };
  });
  await racesDb(h).races.insertMany(docs);
  return { docs, now, seasonId };
}

/** Все страницы списка по курсору. */
async function all(query: string, limit = 4) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const sep = query ? '&' : '';
    const res = await get(
      `/v1/races?${query}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    );
    expect(res.status).toBe(200);
    const page = RacePage.parse(res.body);
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 50);
  return ids;
}

const grace = (doc: RaceDoc) => doc.windowEndsAt.getTime() + MINUTE;

describe('GET /v1/races (AC8)', () => {
  it('current — опубликованные с незакрытым окном по началу окна; past — закрытые и отменённые; курсор без дублей', async () => {
    const { docs, now } = await seed();
    const visible = docs.filter((doc) => doc.status !== 'draft');
    const current = visible
      .filter((doc) => doc.status === 'published' && grace(doc) > now.getTime())
      .sort((a, b) => a.windowStartsAt.getTime() - b.windowStartsAt.getTime());
    const past = visible
      .filter((doc) => doc.status === 'cancelled' || grace(doc) <= now.getTime())
      .sort((a, b) => b.windowEndsAt.getTime() - a.windowEndsAt.getTime());
    expect(current.length + past.length).toBe(visible.length);

    expect(await all('')).toEqual(current.map((doc) => doc._id));
    expect(await all('scope=past', 3)).toEqual(past.map((doc) => doc._id));
  });

  it('фильтры: класс (ИЛИ), месяц по Минску (ИЛИ), класс И месяц', async () => {
    const { docs, now } = await seed();
    const current = docs
      .filter((doc) => doc.status === 'published' && grace(doc) > now.getTime())
      .sort((a, b) => a.windowStartsAt.getTime() - b.windowStartsAt.getTime());
    const inMonth = (doc: RaceDoc, start: string, end: string) =>
      doc.windowStartsAt < new Date(end) && doc.windowEndsAt >= new Date(start);
    const nov = (doc: RaceDoc) => inMonth(doc, '2026-10-31T21:00:00Z', '2026-11-30T21:00:00Z');
    const dec = (doc: RaceDoc) => inMonth(doc, '2026-11-30T21:00:00Z', '2026-12-31T21:00:00Z');

    expect(await all('bikeClass=road&bikeClass=gravel')).toEqual(
      current.filter((doc) => ['road', 'gravel'].includes(doc.bikeClass)).map((doc) => doc._id),
    );
    expect(await all('month=2026-11&month=2026-12')).toEqual(
      current.filter((doc) => nov(doc) || dec(doc)).map((doc) => doc._id),
    );
    expect(await all('bikeClass=tt&month=2026-11')).toEqual(
      current.filter((doc) => doc.bikeClass === 'tt' && nov(doc)).map((doc) => doc._id),
    );
  });

  it('ответ — схема контракта, без служебных полей и владельца; Cache-Control public, max-age=60', async () => {
    await seed();
    const res = await get('/v1/races?limit=50');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const page = RacePage.parse(res.body);
    expect(page.items.length).toBeGreaterThan(0);
    const text = JSON.stringify(res.body);
    for (const field of ['ownerUserId', 'version', 'createdAt', 'publishedAt', 'owner']) {
      expect(text).not.toContain(`"${field}"`);
    }
    expect(page.items[0]).toMatchObject({ season: { name: 'Сезон 2026' } });
  });

  it('карточка: опубликованная и отменённая — 200; черновик и неизвестная — 404', async () => {
    const { docs } = await seed();
    const cancelled = docs.find((doc) => doc.status === 'cancelled')!;
    const res = await get(`/v1/races/${cancelled._id}`);
    expect(res.status).toBe(200);
    expect(RaceDetail.parse(res.body)).toMatchObject({
      phase: 'cancelled',
      cancelReason: 'weather',
      description: cancelled.description,
    });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const draft = docs.find((doc) => doc.status === 'draft')!;
    expect((await get(`/v1/races/${draft._id}`)).status).toBe(404);
    expect((await get(`/v1/races/${uuidv7()}`)).status).toBe(404);
    const list = await all('scope=past', 50);
    expect(list).not.toContain(draft._id);
  });

  it('инъекции и мусор — 400: оператор, лишний ключ, мусорный курсор, limit 51, id не UUID', async () => {
    await seed();
    const garbage = Buffer.from(JSON.stringify({ k: { $gt: '' }, id: uuidv7() })).toString(
      'base64url',
    );
    for (const query of [
      'bikeClass[$ne]=road',
      'status=draft',
      'cursor=abc',
      `cursor=${garbage}`,
      'limit=51',
      'scope=all',
      'month=2026-13',
      // годы вне 1900–9998 — 400, не 500 (Codex pass 2)
      'month=0099-01',
      'month=9999-12',
      'bikeClass=road&bikeClass=tt&bikeClass=gravel&bikeClass=mtb&bikeClass=road',
    ]) {
      expect((await get(`/v1/races?${query}`)).status, query).toBe(400);
    }
    expect((await get('/v1/races/abc')).status).toBe(400);
  });
});

describe('GET /v1/seasons/current (AC8)', () => {
  it('сезон по CLOCK или null', async () => {
    expect(CurrentSeasonResponse.parse((await get('/v1/seasons/current')).body)).toEqual({
      season: null,
    });
    const { seasonId } = await seed();
    const res = await get('/v1/seasons/current');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(CurrentSeasonResponse.parse(res.body)).toEqual({
      season: {
        id: seasonId,
        name: 'Сезон 2026',
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        phase: 'current',
      },
    });
  });
});

describe('IP-лимит public-read', () => {
  it('300 запросов в минуту с адреса — дальше 429 с Retry-After; другой адрес не задет', async () => {
    const ip = '198.51.100.77';
    for (let i = 0; i < 300; i += 1) {
      const res = await get('/v1/seasons/current', ip);
      if (res.status !== 200) throw new Error(`запрос ${i}: ${res.status}`);
    }
    const limited = await get('/v1/seasons/current', ip);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await get('/v1/calendar', ip)).status).toBe(429);
    expect((await get('/v1/seasons/current', '198.51.100.78')).status).toBe(200);
  });
});
