import type { Clock } from '@rkarakulov/api-kit/core';
import { describe, expect, it } from 'vitest';

import type { RacesForSharing } from '../races';
import type { OgCardInputs } from './og-card.inputs';
import { SITEMAP_POLICY } from './sharing.policy';
import { SitemapService } from './sitemap.service';

const AT = new Date('2026-10-29T10:00:00Z');
const id = (n: number) => `01890a5d-ac96-774b-bcce-${n.toString(16).padStart(12, '0')}`;

/** Поток строк одного вида: `total` строк по курсору `(updatedAt, id)`; счётчик вызовов. */
function changedStream(total: Partial<Record<string, number>>) {
  const calls: { kind: string; limit: number }[] = [];
  const changed = (kind: string, after: { at: Date; id: string } | null, limit: number) => {
    calls.push({ kind, limit });
    const start = after ? Number.parseInt(after.id.slice(-12), 16) + 1 : 0;
    const end = Math.min(total[kind] ?? 0, start + limit);
    const rows = [];
    for (let n = start; n < end; n += 1) rows.push({ id: id(n), updatedAt: AT });
    return Promise.resolve(rows);
  };
  return { inputs: { changed } as unknown as OgCardInputs, calls };
}

const races = (seasons: { id: string; updatedAt: Date }[] = []) =>
  ({ sitemapSeasons: () => Promise.resolve(seasons) }) as unknown as RacesForSharing;

function clock(start = AT) {
  let now = start.getTime();
  return {
    clock: { now: () => new Date(now) } as Clock,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('SitemapService (landing-seo)', () => {
  it('гонки, маршруты, старты — постранично по курсору до конца; сезоны — порт races; райдов нет', async () => {
    const { inputs, calls } = changedStream({
      race: SITEMAP_POLICY.scanPage + 3,
      route: 2,
      calendar: 0,
      ride: 5,
    });
    const service = new SitemapService(
      inputs,
      races([{ id: id(900), updatedAt: AT }]),
      clock().clock,
    );
    const { items } = await service.entries();
    const count = (kind: string) => items.filter((item) => item.kind === kind).length;
    expect(count('race')).toBe(SITEMAP_POLICY.scanPage + 3);
    expect(count('route')).toBe(2);
    expect(count('calendar')).toBe(0);
    expect(count('season')).toBe(1);
    expect(count('ride')).toBe(0);
    expect(new Set(items.map((item) => `${item.kind}:${item.id}`)).size).toBe(items.length);
    expect(items[0]).toEqual({ kind: 'race', id: id(0), updatedAt: AT.toISOString() });
    expect(calls.every((call) => call.kind !== 'ride')).toBe(true);
  });

  it('лимит вида: не больше kindLimit записей, лишних страниц не читает', async () => {
    const { inputs, calls } = changedStream({ race: SITEMAP_POLICY.kindLimit + 50 });
    const { items } = await new SitemapService(inputs, races(), clock().clock).entries();
    expect(items).toHaveLength(SITEMAP_POLICY.kindLimit);
    expect(calls.filter((call) => call.kind === 'race')).toHaveLength(
      Math.ceil(SITEMAP_POLICY.kindLimit / SITEMAP_POLICY.scanPage),
    );
  });

  it('мемо: в окне — без чтения, после окна — заново; сбой не запоминается', async () => {
    const { inputs, calls } = changedStream({ race: 1 });
    const time = clock();
    let fail = true;
    const flaky = {
      sitemapSeasons: () => (fail ? Promise.reject(new Error('db')) : Promise.resolve([])),
    } as unknown as RacesForSharing;
    const service = new SitemapService(inputs, flaky, time.clock);
    await expect(service.entries()).rejects.toThrow('db');
    fail = false;
    await service.entries();
    const scans = calls.length;
    time.advance(SITEMAP_POLICY.memoMs - 1);
    await service.entries();
    expect(calls).toHaveLength(scans);
    time.advance(1);
    await service.entries();
    expect(calls.length).toBeGreaterThan(scans);
  });
});
