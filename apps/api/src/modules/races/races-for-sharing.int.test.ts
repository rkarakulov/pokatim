import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { seedOgSeason, seedRace } from '../../../test/og';
import { seedSeason } from '../../../test/standings';
import { RACES_FOR_SHARING, type RacesForSharing } from './index';

/** Порт OG-картинки гонки (og-images, D7/D9): только опубликованная, без владельца и описания; keyset изменений. */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const port = () => h.app.get<RacesForSharing>(RACES_FOR_SHARING);
const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 10, minute));

describe('ogFacts', () => {
  it('опубликованная — публичные факты, коридор → routeId; без владельца и описания', async () => {
    const routeId = uuidv7();
    const id = await seedRace(h, { corridor: { routeId, widthM: 50, distanceM: 42_000 } });
    const facts = await port().ogFacts(id);
    expect(facts).toEqual({
      raceId: id,
      title: 'Минское кольцо',
      windowStartsAt: new Date('2026-10-23T21:00:00Z'),
      windowEndsAt: new Date('2026-10-26T20:59:00Z'),
      distanceKm: 42.5,
      bikeClass: 'road',
      routeId,
    });
    expect(await port().ogFacts(await seedRace(h))).toMatchObject({ routeId: null });
  });

  it('черновик, отменённая, неизвестная — null', async () => {
    const draft = await seedRace(h, { status: 'draft' });
    const cancelled = await seedRace(h, { status: 'cancelled' });
    for (const id of [draft, cancelled, uuidv7()]) expect(await port().ogFacts(id)).toBeNull();
  });
});

describe('ogChanged', () => {
  it('порядок (updatedAt, _id), курсор на равных updatedAt, limit; непубличные — нет', async () => {
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()].sort();
    await seedRace(h, { _id: c!, updatedAt: at(1) });
    await seedRace(h, { _id: b!, updatedAt: at(2) });
    await seedRace(h, { _id: a!, updatedAt: at(2) });
    await seedRace(h, { status: 'draft', updatedAt: at(3) });
    await seedRace(h, { status: 'cancelled', updatedAt: at(3) });

    expect(await port().ogChanged(null, 10)).toEqual([
      { id: c, updatedAt: at(1) },
      { id: a, updatedAt: at(2) },
      { id: b, updatedAt: at(2) },
    ]);
    expect(await port().ogChanged(null, 2)).toHaveLength(2);
    expect(await port().ogChanged({ at: at(2), id: a! }, 10)).toEqual([
      { id: b, updatedAt: at(2) },
    ]);
    expect(await port().ogChanged({ at: at(2), id: b! }, 10)).toEqual([]);
  });
});

describe('sitemapRange, sitemapSeasonsRange (sitemap-index)', () => {
  const all = { after: null, until: null };
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  it('опубликованные гонки по _id ↑ в диапазоне (after, until], не больше limit; черновик и отменённая — нет', async () => {
    const races = [await seedRace(h), await seedRace(h), await seedRace(h)].sort();
    await seedRace(h, { status: 'draft' });
    await seedRace(h, { status: 'cancelled' });
    const now = h.clock.now();
    expect(await port().sitemapRange(all, 10)).toEqual(races.map((id) => ({ id, updatedAt: now })));
    expect(ids(await port().sitemapRange(all, 2))).toEqual(races.slice(0, 2));
    expect(ids(await port().sitemapRange({ after: races[0]!, until: null }, 10))).toEqual(
      races.slice(1),
    );
    expect(ids(await port().sitemapRange({ after: null, until: races[1]! }, 10))).toEqual(
      races.slice(0, 2),
    );
    expect(ids(await port().sitemapRange({ after: races[0]!, until: races[1]! }, 10))).toEqual([
      races[1],
    ]);
    expect(await port().sitemapRange({ after: races[2]!, until: null }, 10)).toEqual([]);
  });

  it('все сезоны по _id ↑ в диапазоне: id и дата изменения; нет сезонов — пусто', async () => {
    expect(await port().sitemapSeasonsRange(all, 10)).toEqual([]);
    const seasons = [await seedSeason(h), await seedSeason(h, 'Сезон 2027', { year: 2027 })].sort();
    const now = h.clock.now();
    expect(await port().sitemapSeasonsRange(all, 10)).toEqual(
      seasons.map((id) => ({ id, updatedAt: now })),
    );
    expect(ids(await port().sitemapSeasonsRange({ after: seasons[0]!, until: null }, 1))).toEqual([
      seasons[1],
    ]);
    expect(ids(await port().sitemapSeasonsRange({ after: null, until: seasons[0]! }, 10))).toEqual([
      seasons[0],
    ]);
  });
});

describe('seasonOgFacts (og-rider-season-dark, S2)', () => {
  it('название, даты Минска и число только опубликованных гонок сезона; неизвестный — null', async () => {
    const seasonId = await seedOgSeason(h, { name: 'Кубок Минска 2026' });
    await seedRace(h, { seasonId });
    await seedRace(h, { seasonId });
    await seedRace(h, { seasonId, status: 'cancelled' });
    await seedRace(h, { status: 'draft' });
    await seedRace(h, {
      seasonId: await seedOgSeason(h, { startsOn: '2025-04-01', endsOn: '2025-10-31' }),
    });

    expect(await port().seasonOgFacts(seasonId)).toEqual({
      seasonId,
      title: 'Кубок Минска 2026',
      startsOn: '2026-04-01',
      endsOn: '2026-10-31',
      raceCount: 2,
    });
    expect(await port().seasonOgFacts(uuidv7())).toBeNull();
  });

  it('сезон без гонок — raceCount 0', async () => {
    const seasonId = await seedOgSeason(h);
    expect(await port().seasonOgFacts(seasonId)).toMatchObject({ raceCount: 0 });
  });
});

describe('liveSeasonIds (RC-2a)', () => {
  it('сезоны с endsOn ≥ границы (включительно), по id', async () => {
    const [a, b] = [uuidv7(), uuidv7()].sort();
    await seedOgSeason(h, { _id: b!, startsOn: '2026-04-01', endsOn: '2026-09-22' });
    await seedOgSeason(h, { _id: a!, startsOn: '2026-10-01', endsOn: '2027-03-31' });
    await seedOgSeason(h, { startsOn: '2025-04-01', endsOn: '2026-09-21' });

    expect(await port().liveSeasonIds('2026-09-22')).toEqual([a, b]);
    expect(await port().liveSeasonIds('2026-09-23')).toEqual([a]);
    expect(await port().liveSeasonIds('2027-04-01')).toEqual([]);
  });
});
