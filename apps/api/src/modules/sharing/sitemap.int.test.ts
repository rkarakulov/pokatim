import { SitemapEntries } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, MINUTE, type Harness } from '../../../test/harness';
import { seedRace, seedStart } from '../../../test/og';
import { seedRiderRoute } from '../../../test/routes';
import { createRide, rider, seedTeamRoute } from '../../../test/rides';
import { seedSeason } from '../../../test/standings';
import { SITEMAP_POLICY } from './sharing.policy';
import { SitemapService } from './sitemap.service';

/**
 * Карта сайта (landing-seo, AC3, AC4): `GET /v1/sitemap` — только опубликованные гонки, сезоны, маршруты каталога и
 * старты календаря; мемо процесса. MongoDB — настоящая.
 */
let h: Harness;
let ip = 0;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  h.app.get(SitemapService).forget();
  ip += 1;
});
afterAll(async () => {
  await h.close();
});

const get = () =>
  h.app.inject({
    method: 'GET',
    url: '/v1/sitemap',
    headers: { 'x-forwarded-for': `10.8.${ip % 250}.1` },
  });

async function entries() {
  const res = await get();
  expect(res.statusCode, res.body).toBe(200);
  return SitemapEntries.parse(res.json()).items;
}

const keys = (items: { kind: string; id: string }[]) =>
  items.map(({ kind, id }) => `${kind}:${id}`).sort();

describe('GET /v1/sitemap', () => {
  it('публичные объекты 4 видов с датой изменения; кэш 60 с; без входа', async () => {
    const routeId = await seedTeamRoute(h);
    const race = await seedRace(h);
    const season = await seedSeason(h);
    const start = await seedStart(h);
    const res = await get();
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const items = SitemapEntries.parse(res.json()).items;
    expect(keys(items)).toEqual(
      keys([
        { kind: 'race', id: race },
        { kind: 'season', id: season },
        { kind: 'route', id: routeId },
        { kind: 'calendar', id: start },
      ]),
    );
    for (const item of items) expect(item.updatedAt).toBe(h.clock.now().toISOString());
  });

  it('черновик и отменённая гонка, маршрут не в каталоге, неопубликованный старт, райды — не входят', async () => {
    const organizer = await rider(h, 'org@example.by');
    await seedRace(h, { status: 'draft' });
    await seedRace(h, { status: 'cancelled' });
    await seedRiderRoute(h, organizer.userId);
    await seedStart(h, { status: 'unpublished' });
    await createRide(h, organizer);
    expect(await entries()).toEqual([]);
  });

  it('мемо: в окне — прежний ответ без чтения БД; после окна — новые объекты (AC4)', async () => {
    const first = await seedRace(h);
    expect(keys(await entries())).toEqual([`race:${first}`]);
    const second = await seedRace(h);
    h.clock.advance(SITEMAP_POLICY.memoMs - MINUTE);
    expect(keys(await entries())).toEqual([`race:${first}`]);
    h.clock.advance(2 * MINUTE);
    expect(keys(await entries())).toEqual(
      keys([
        { kind: 'race', id: first },
        { kind: 'race', id: second },
      ]),
    );
  });
});
