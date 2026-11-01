import type { SitemapKind } from '@pokatim/contracts';
import type { Clock } from '@rkarakulov/api-kit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IdRange } from '../../changed-since';
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
  const calls: { kind: SitemapKind; range: IdRange; limit: number }[] = [];
  let fail = false;
  const source = (kind: SitemapKind) => (range: IdRange, limit: number) => {
    calls.push({ kind, range, limit });
    if (fail) return Promise.reject(new Error('db'));
    const list = [...(rows[kind] ?? [])]
      .sort((a, b) => a - b)
      .map((n) => ({ id: id(n), updatedAt: at(n) }))
      .filter((row) => range.after === null || row.id > range.after)
      .filter((row) => range.until === null || row.id <= range.until);
    return Promise.resolve(list.slice(0, limit));
  };
  const races = {
    sitemapRange: source('race'),
    sitemapSeasonsRange: source('season'),
  } as unknown as RacesForSharing;
  const routes = { sitemapRange: source('route') } as unknown as RoutesForSharing;
  const calendar = { sitemapRange: source('calendar') } as unknown as CalendarForSharing;
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
    now: () => new Date(now),
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

const ids = async (page: Promise<{ items: { id: string }[] } | null>) =>
  (await page)!.items.map((item) => item.id);

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

  it('проход keyset по _id чанками scanPage до неполного чанка, без верхней границы', async () => {
    const { service: s, calls } = service({ race: range(0, 4) });
    await s.index();
    expect(calls.filter((call) => call.kind === 'race')).toEqual([
      { kind: 'race', range: { after: null, until: null }, limit: 2 },
      { kind: 'race', range: { after: id(1), until: null }, limit: 2 },
      { kind: 'race', range: { after: id(3), until: null }, limit: 2 },
    ]);
  });
});

describe('SitemapService.page (sitemap-index)', () => {
  it('страницы вида вместе — все объекты по _id, без потерь и дублей; вне индекса — null', async () => {
    const { service: s } = service({ race: range(0, 7) });
    const pages = [];
    for (const n of [1, 2, 3]) pages.push(await ids(s.page('race', n)));
    expect(pages).toEqual([range(0, 3).map(id), range(3, 3).map(id), [id(6)]]);
    expect(await s.page('race', 4)).toBeNull();
    expect(await s.page('calendar', 1)).toBeNull();
    expect((await s.page('race', 1))!.items[0]).toEqual({
      id: id(0),
      updatedAt: at(0).toISOString(),
    });
  });

  it('ограниченная страница читает (after, last] — без запроса за last', async () => {
    const { service: s, calls } = service({ race: range(0, 7) });
    await s.index();
    calls.length = 0;
    await s.page('race', 2);
    expect(calls).toEqual([
      { kind: 'race', range: { after: id(2), until: id(5) }, limit: 2 },
      { kind: 'race', range: { after: id(4), until: id(5) }, limit: 2 },
    ]);
  });

  it('стабильность: строка внутри диапазона ограниченной страницы остаётся в ней; хвост — в своей', async () => {
    const rows = { race: [0, 2, 4, 6, 8, 10, 12] };
    const { service: s } = service(rows);
    await s.index();
    // вставка внутрь диапазона первой страницы (uuidv7 в той же миллисекунде) после сборки индекса
    rows.race.push(1);
    expect(await ids(s.page('race', 1))).toEqual([0, 1, 2, 4].map(id));
    expect(await ids(s.page('race', 2))).toEqual([6, 8, 10].map(id));
  });

  it('последняя страница: свои строки целиком, новые после last — пока не больше pageSize', async () => {
    const rows = { race: [0, 1, 2, 3] };
    const { service: s } = service(rows);
    await s.index();
    rows.race.push(4, 5, 6);
    expect(await ids(s.page('race', 2))).toEqual([3, 4, 5].map(id));
  });

  it('последняя полная страница не вытесняет свои строки вставкой внутрь диапазона', async () => {
    const rows = { race: [0, 10, 20, 30, 40, 50] };
    const { service: s } = service(rows);
    await s.index();
    rows.race.push(35, 60);
    expect(await ids(s.page('race', 2))).toEqual([30, 35, 40, 50].map(id));
  });

  it('ограниченная страница — не больше fileUrlMax при вставках', async () => {
    const rows = { race: [0, 100, 200, 300] };
    const { service: s } = service(rows);
    await s.index();
    rows.race.push(...range(1, 10));
    expect((await s.page('race', 1))!.items).toHaveLength(SITEMAP_POLICY.fileUrlMax);
  });
});

describe('SitemapService lastmod (sitemap-index)', () => {
  it('первое поколение — максимум updatedAt; состав не изменился — прежний lastmod', async () => {
    const { service: s, time } = service({ race: range(0, 5) });
    const first = (await s.index()).pages.map((page) => page.updatedAt);
    expect(first).toEqual([at(2).toISOString(), at(4).toISOString()]);
    time.advance(SITEMAP_POLICY.memoMs);
    expect((await s.index()).pages.map((page) => page.updatedAt)).toEqual(first);
  });

  it('публикация старого объекта сдвигает границы — lastmod сдвинутых страниц = сборка индекса, прежних — без изменений', async () => {
    const rows = { race: [10, 20, 30, 40, 50, 60, 70] };
    const { service: s, time } = service(rows);
    await s.index();
    time.advance(SITEMAP_POLICY.memoMs);
    // опубликован черновик, созданный давно (`_id` внутри второй страницы, `updatedAt` старше страниц)
    rows.race.push(45);
    const built = time.now().toISOString();
    expect((await s.index()).pages).toEqual([
      { kind: 'race', page: 1, updatedAt: at(30).toISOString() },
      { kind: 'race', page: 2, updatedAt: built },
      { kind: 'race', page: 3, updatedAt: built },
    ]);
  });

  it('снятие объекта (число строк страницы изменилось) — lastmod = сборка индекса', async () => {
    const rows = { race: [10, 20, 30, 40] };
    const { service: s, time } = service(rows);
    await s.index();
    time.advance(SITEMAP_POLICY.memoMs);
    rows.race.splice(rows.race.indexOf(40), 1);
    rows.race.splice(rows.race.indexOf(20), 1);
    expect((await s.index()).pages.map((page) => page.updatedAt)).toEqual([
      time.now().toISOString(),
    ]);
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

  it('страница истекает вместе с поколением индекса: первое чтение поздно в окне, вставка в неизменных границах', async () => {
    const rows = { race: [0, 10, 20, 30] };
    const { service: s, time } = service(rows);
    await s.index();
    time.advance(SITEMAP_POLICY.memoMs - 1_000);
    expect(await ids(s.page('race', 1))).toEqual([0, 10, 20].map(id));
    rows.race.push(5);
    time.advance(1_000);
    const pages = (await s.index()).pages;
    expect(pages[0]!.updatedAt).toBe(time.now().toISOString());
    expect(await ids(s.page('race', 1))).toEqual([0, 5, 10].map(id));
  });

  it('одновременные запросы делят одно чтение; сбой не запоминается', async () => {
    const { service: s, calls, failing } = service({ route: [0] });
    failing(true);
    await expect(s.index()).rejects.toThrow('db');
    failing(false);
    calls.length = 0;
    await Promise.all([s.index(), s.index(), s.page('route', 1)]);
    // индекс: по одному вызову на вид; страница — один вызов (последняя: свои границы, затем хвост)
    expect(calls).toHaveLength(6);
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
