import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { daysAgo, seedActivity, seedRouteRide } from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { catalogCorridorRoute, ownCorridorRoute } from '../../../test/route-rides';
import { routesDb } from '../../../test/routes';
import { tracks } from '../../../test/tracks';
import {
  RIDER_ROUTE_RIDES,
  RIDER_ROUTE_RIDES_MAX_ROWS,
  type RiderRouteRides,
} from './rider-route-rides.port';
import { RouteRidesRepository } from './route-rides.repository';

/** Порт `RiderRouteRides` (achievements): пройденные заезды по видимым райдеру маршрутам с живой активностью. */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const ME = '01890a5d-ac96-774b-bcce-b30209900001';
const OTHER = '01890a5d-ac96-774b-bcce-b30209900002';

const port = () => h.app.get<RiderRouteRides>(RIDER_ROUTE_RIDES, { strict: false });
const sorted = (facts: Awaited<ReturnType<RiderRouteRides['passedOf']>>) =>
  [...facts].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

describe('RiderRouteRides.passedOf (achievements)', () => {
  it('только passed; повторы маршрута — отдельными фактами; дата — старт активности; чужие — нет', async () => {
    const catalog = await catalogCorridorRoute(h, OTHER);
    const own = await ownCorridorRoute(h, ME);
    await seedRouteRide(h, ME, catalog, daysAgo(h, 5));
    await seedRouteRide(h, ME, catalog, daysAgo(h, 3));
    await seedRouteRide(h, ME, own, daysAgo(h, 4));
    for (const status of ['not_passed', 'failed', 'queued'] as const) {
      await seedRouteRide(h, ME, catalog, daysAgo(h, 1), { status });
    }
    await seedRouteRide(h, OTHER, catalog, daysAgo(h, 2));

    expect(sorted(await port().passedOf(ME))).toEqual([
      { routeId: catalog, routeTitle: 'Эталонный коридор', startedAt: daysAgo(h, 5) },
      { routeId: own, routeTitle: 'Мой коридор', startedAt: daysAgo(h, 4) },
      { routeId: catalog, routeTitle: 'Эталонный коридор', startedAt: daysAgo(h, 3) },
    ]);
  });

  it('удалённая активность, маршрут вне каталога, чужой непубличный, свой удалённый — заездов нет', async () => {
    const catalog = await catalogCorridorRoute(h, OTHER);
    const own = await ownCorridorRoute(h, ME);
    const foreign = await ownCorridorRoute(h, OTHER);
    const deleted = await seedRouteRide(h, ME, catalog, daysAgo(h, 5));
    await seedRouteRide(h, ME, foreign, daysAgo(h, 4));
    await seedRouteRide(h, ME, own, daysAgo(h, 3));
    await tracks(h).activities.deleteOne({ _id: deleted });
    expect((await port().passedOf(ME)).map((fact) => fact.routeId)).toEqual([own]);

    await seedRouteRide(h, ME, catalog, daysAgo(h, 2), {
      activityId: await seedActivity(h, ME, daysAgo(h, 2)),
    });
    expect(await port().passedOf(ME)).toHaveLength(2);
    await routesDb(h).routes.updateOne({ _id: catalog }, { $set: { catalog: null } });
    await routesDb(h).routes.deleteOne({ _id: own });
    expect(await port().passedOf(ME)).toEqual([]);
  });

  it('предел строк — лог `achievements.route_rides_truncated` без отказа', async () => {
    const catalog = await catalogCorridorRoute(h, OTHER);
    await seedRouteRide(h, ME, catalog, daysAgo(h, 1));
    const repository = h.app.get(RouteRidesRepository, { strict: false });
    const original = repository.passedOf.bind(repository);
    vi.spyOn(repository, 'passedOf').mockImplementation(async (userId) => {
      const rows = await original(userId, RIDER_ROUTE_RIDES_MAX_ROWS);
      return Array.from({ length: RIDER_ROUTE_RIDES_MAX_ROWS }, () => rows[0]!);
    });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(await port().passedOf(ME)).toHaveLength(RIDER_ROUTE_RIDES_MAX_ROWS);
    expect(warn.mock.calls.map((args) => String(args[0]))).toContain(
      `achievements.route_rides_truncated uid=${ME} limit=${RIDER_ROUTE_RIDES_MAX_ROWS}`,
    );
  });
});

describe('RiderRouteRides.routeTitles (achievements-panel, ручная выдача)', () => {
  it('каталог и свой готовый — название; чужой приватный, снятый с каталога, неизвестный — нет', async () => {
    const catalog = await catalogCorridorRoute(h, OTHER);
    const own = await ownCorridorRoute(h, ME);
    const foreign = await ownCorridorRoute(h, OTHER);
    const removed = await catalogCorridorRoute(h, OTHER);
    await routesDb(h).routes.updateOne({ _id: removed }, { $set: { catalog: null } });
    const unknown = '01890a5d-ac96-774b-bcce-b302099a8057';

    const titles = await port().routeTitles(ME, [catalog, own, foreign, removed, unknown, own]);
    expect(Object.fromEntries(titles)).toEqual({
      [catalog]: 'Эталонный коридор',
      [own]: 'Мой коридор',
    });
    expect(await port().routeTitles(ME, [])).toEqual(new Map());
  });
});
