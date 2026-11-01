import type { SitemapKind } from '@pokatim/contracts';
import type { Clock } from '@rkarakulov/api-kit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CalendarForSharing } from '../calendar';
import type { RacesForSharing } from '../races';
import type { RoutesForSharing } from '../routes';
import { SITEMAP_POLICY } from './sharing.policy';
import { SitemapService } from './sitemap.service';

const AT = new Date('2026-10-29T10:00:00Z');
const at = (n: number) => new Date(AT.getTime() + n * 1_000);
const id = (n: number) => `01890a5d-ac96-774b-bcce-${n.toString(16).padStart(12, '0')}`;

/** Строки видов по `_id` ↑: номера строк вида (`id(n)`, `updatedAt` — `at(n)`); журнал вызовов портов. */
function sources(rows: Partial<Record<SitemapKind, number[]>>) {
  const calls: { kind: SitemapKind; after: string | null; limit: number }[] = [];
  let fail = false;
  const source = (kind: SitemapKind) => (after: string | null, limit: number) => {
    calls.push({ kind, after, limit });
    if (fail) return Promise.reject(new Error('db'));
    const list = [...(rows[kind] ?? [])]
      .sort((a, b) => a - b)
      .map((n) => ({ id: id(n), updatedAt: at(n) }))
      .filter((row) => after === null || row.id > after);
    return Promise.resolve(list.slice(0, limit));
  };
  const races = {
    sitemapAfter: source('race'),
    sitemapSeasonsAfter: source('season'),
  } as unknown as RacesForSharing;
  const routes = { sitemapAfter: source('route') } as unknown as RoutesForSharing;
  const calendar = { sitemapAfter: source('calendar') } as unknown as CalendarForSharing;
  return {
    races,
    routes,
    calendar,
    calls,
    failing: (value: boolean) => {
      fail = value;
    },
  };
}

function clock(start = AT) {
  let now = start.getTime();
  return {
    clock: { now: () => new Date(now) } as Clock,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, n) => from + n);

const saved = { ...SITEMAP_POLICY };
beforeEach(() => {
  Object.assign(SITEMAP_POLICY, { pageSize: 3, scanPage: 2, fileUrlMax: 5 });
});
afterEach(() => {
  Object.assign(SITEMAP_POLICY, saved);
});

function service(rows: Partial<Record<SitemapKind, number[]>>, time = clock()) {
  const s = sources(rows);
  return { ...s, time, service: new SitemapService(s.races, s.routes, s.calendar, time.clock) };
}

describe('SitemapService.index (sitemap-index)', () => {
  it('страницы видов по pageSize в порядке SITEMAP_KINDS; lastmod — максимум страницы; пустой вид — без страниц', async () => {
    const { service: s } = service({
      race: range(0, 7),
      season: [100],
      route: range(200, 3),
      calendar: [],
    });
    expect(await s.index()).toEqual({
      pages: [
        { kind: 'race', page: 1, updatedAt: at(2).toISOString() },
        { kind: 'race', page: 2, updatedAt: at(5).toISOString() },
        { kind: 'race', page: 3, updatedAt: at(6).toISOString() },
        { kind: 'season', page: 1, updatedAt: at(100).toISOString() },
        { kind: 'route', page: 1, updatedAt: at(202).toISOString() },
      ],
    });
  });

  it('нет объектов — пустой индекс', async () => {
    expect(await service({}).service.index()).toEqual({ pages: [] });
  });

  it('проход keyset по _id чанками scanPage до неполного чанка', async () => {
    const { service: s, calls } = service({ race: range(0, 4) });
    await s.index();
    expect(calls.filter((call) => call.kind === 'race')).toEqual([
      { kind: 'race', after: null, limit: 2 },
      { kind: 'race', after: id(1), limit: 2 },
      { kind: 'race', after: id(3), limit: 2 },
    ]);
  });
});

describe('SitemapService.page (sitemap-index)', () => {
  it('страницы вида вместе — все объекты по _id, без потерь и дублей; вне индекса — null', async () => {
    const { service: s } = service({ race: range(0, 7) });
    const pages = [];
    for (const n of [1, 2, 3]) pages.push((await s.page('race', n))!.items.map((item) => item.id));
    expect(pages).toEqual([range(0, 3).map(id), range(3, 3).map(id), [id(6)]]);
    expect(await s.page('race', 4)).toBeNull();
    expect(await s.page('calendar', 1)).toBeNull();
    expect((await s.page('race', 1))!.items[0]).toEqual({
      id: id(0),
      updatedAt: at(0).toISOString(),
    });
  });

  it('стабильность: строка внутри диапазона ограниченной страницы остаётся в ней; хвост — в своей', async () => {
    const rows = { race: [0, 2, 4, 6, 8, 10, 12] };
    const { service: s } = service(rows);
    await s.index();
    // вставка внутрь диапазона первой страницы (не uuidv7) после сборки индекса
    rows.race.push(1);
    expect((await s.page('race', 1))!.items.map((item) => item.id)).toEqual([0, 1, 2, 4].map(id));
    expect((await s.page('race', 2))!.items.map((item) => item.id)).toEqual([6, 8, 10].map(id));
  });

  it('последняя страница — открыта, не больше pageSize: новые объекты после индекса попадают до заполнения', async () => {
    const rows = { race: [0, 1, 2, 3] };
    const { service: s } = service(rows);
    await s.index();
    rows.race.push(4, 5, 6);
    expect((await s.page('race', 2))!.items.map((item) => item.id)).toEqual([3, 4, 5].map(id));
  });

  it('ограниченная страница — не больше fileUrlMax при вставках', async () => {
    const rows = { race: [0, 100, 200, 300] };
    const { service: s } = service(rows);
    await s.index();
    rows.race.push(...range(1, 10));
    expect((await s.page('race', 1))!.items).toHaveLength(SITEMAP_POLICY.fileUrlMax);
  });
});

describe('SitemapService мемо (sitemap-index)', () => {
  it('в окне — без чтения портов; после окна — заново; новые объекты — после окна', async () => {
    const rows = { race: [0] };
    const { service: s, calls, time } = service(rows);
    await s.index();
    await s.page('race', 1);
    const reads = calls.length;
    rows.race.push(1, 2, 3);
    time.advance(SITEMAP_POLICY.memoMs - 1);
    expect((await s.index()).pages).toHaveLength(1);
    expect((await s.page('race', 1))!.items).toHaveLength(1);
    expect(calls).toHaveLength(reads);
    time.advance(1);
    expect((await s.index()).pages).toHaveLength(2);
    expect(calls.length).toBeGreaterThan(reads);
  });

  it('одновременные запросы делят одно чтение; сбой не запоминается', async () => {
    const { service: s, calls, failing } = service({ route: [0] });
    failing(true);
    await expect(s.index()).rejects.toThrow('db');
    failing(false);
    calls.length = 0;
    await Promise.all([s.index(), s.index(), s.page('route', 1)]);
    // индекс: по одному вызову на вид; страница — один вызов
    expect(calls).toHaveLength(5);
  });

  it('страниц в мемо — не больше pageMemoMax: старейшая вытесняется', async () => {
    Object.assign(SITEMAP_POLICY, { pageSize: 1, pageMemoMax: 2 });
    const { service: s, calls } = service({ race: [0, 1, 2] });
    await s.index();
    for (const n of [1, 2, 3]) await s.page('race', n);
    calls.length = 0;
    await s.page('race', 3);
    expect(calls).toHaveLength(0);
    await s.page('race', 1);
    expect(calls).toHaveLength(1);
  });
});
