import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { seedRace } from '../../../test/og';
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
