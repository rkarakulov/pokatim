import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { publicationDoc, RIDER_LINE, routesDb, seedRiderRoute } from '../../../test/routes';
import { seedApprovedRoute, seedTeamRoute } from '../../../test/rides';
import { ROUTES_FOR_SHARING, type RoutesForSharing } from './index';

/** Порт OG-картинки маршрута каталога (og-images, D7/D9): только `IN_CATALOG`, без автора; линия; keyset. */
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

const port = () => h.app.get<RoutesForSharing>(ROUTES_FOR_SHARING);
const RIDER = '01890a5d-0000-7000-8000-0000000000bb';
const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 10, minute));

describe('ogFacts / ogLine', () => {
  it('маршрут команды и одобренный маршрут райдера — факты без автора; линия показа', async () => {
    const team = await seedTeamRoute(h, undefined, 'Кольцо команды');
    expect(await port().ogFacts(team)).toEqual({
      routeId: team,
      title: 'Кольцо команды',
      distanceM: 1300,
      elevationGainM: 120,
      isLoop: false,
      city: 'minsk',
    });
    const approved = await seedApprovedRoute(h, RIDER);
    const facts = await port().ogFacts(approved);
    expect(facts).toMatchObject({ routeId: approved, city: expect.any(String) });
    expect(JSON.stringify(facts)).not.toContain(RIDER);
    expect(await port().ogLine(team)).toEqual(RIDER_LINE);
  });

  it('заявка райдера (pending), свой маршрут, снятый с каталога, неизвестный — null и без линии', async () => {
    const pending = await seedRiderRoute(h, RIDER, { publication: publicationDoc(h, 'pending') });
    const own = await seedRiderRoute(h, RIDER);
    const removed = await seedTeamRoute(h);
    await routesDb(h).routes.updateOne({ _id: removed }, { $set: { catalog: null } });
    for (const id of [pending, own, removed, uuidv7()]) {
      expect(await port().ogFacts(id)).toBeNull();
      expect(await port().ogLine(id)).toBeNull();
    }
  });
});

describe('ogChanged', () => {
  it('только каталог; порядок (updatedAt, _id), курсор, limit', async () => {
    const first = await seedTeamRoute(h);
    const second = await seedApprovedRoute(h, RIDER);
    const own = await seedRiderRoute(h, RIDER);
    await routesDb(h).routes.updateOne({ _id: first }, { $set: { updatedAt: at(2) } });
    await routesDb(h).routes.updateOne({ _id: second }, { $set: { updatedAt: at(1) } });
    await routesDb(h).routes.updateOne({ _id: own }, { $set: { updatedAt: at(3) } });
    expect(await port().ogChanged(null, 10)).toEqual([
      { id: second, updatedAt: at(1) },
      { id: first, updatedAt: at(2) },
    ]);
    expect(await port().ogChanged(null, 1)).toHaveLength(1);
    expect(await port().ogChanged({ at: at(1), id: second }, 10)).toEqual([
      { id: first, updatedAt: at(2) },
    ]);
  });
});
