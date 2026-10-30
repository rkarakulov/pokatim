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

describe('sitemapSeasons (landing-seo)', () => {
  it('все сезоны: id и дата изменения; нет сезонов — пусто', async () => {
    expect(await port().sitemapSeasons()).toEqual([]);
    const id = await seedSeason(h);
    expect(await port().sitemapSeasons()).toEqual([{ id, updatedAt: h.clock.now() }]);
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
