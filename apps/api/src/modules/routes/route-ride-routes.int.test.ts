import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { CORRIDOR, corridorRoute } from '../../../test/results';
import {
  publicationDoc,
  RIDER_LINE,
  routesDb,
  seedApprovedRiderRoute,
  seedRiderRoute,
} from '../../../test/routes';
import { ROUTE_RIDE_ROUTES, type RouteRideRoutes } from './route-ride-routes.port';

/** Порт `RouteRideRoutes` (route-rides-01): видимость маршрута заезда — каталог или свой готовый, без кэша. */
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

const ME = '01890a5d-ac96-774b-bcce-b30209900001';
const OTHER = '01890a5d-ac96-774b-bcce-b30209900002';
const UNKNOWN = '01890a5d-ac96-774b-bcce-b30209900099';

const port = () => h.worker.get<RouteRideRoutes>(ROUTE_RIDE_ROUTES);
const catalogDoc = () => ({
  city: 'minsk' as const,
  surfaces: ['asphalt' as const],
  publishedAt: h.clock.now(),
});

async function inCatalog(id: string) {
  await routesDb(h).routes.updateOne({ _id: id }, { $set: { catalog: catalogDoc() } });
}

describe('RouteRideRoutes (route-rides-01)', () => {
  it('видимы: платформа в каталоге, одобренный чужой маршрут райдера, свой готовый — с рамкой и доступом', async () => {
    const platform = await corridorRoute(h, OTHER);
    await inCatalog(platform);
    const approved = await seedApprovedRiderRoute(h, OTHER);
    const own = await seedRiderRoute(h, ME);

    expect(await port().rideable(platform, ME)).toEqual({
      id: platform,
      title: 'Эталонный коридор',
      distanceM: CORRIDOR.distanceM,
      isLoop: false,
      bounds: expect.any(Array),
      access: 'catalog',
    });
    expect(await port().rideable(approved, ME)).toMatchObject({ id: approved, access: 'catalog' });
    expect(await port().rideable(own, ME)).toEqual({
      id: own,
      title: 'Мой маршрут',
      distanceM: 1300,
      isLoop: false,
      bounds: [RIDER_LINE[0]![0], RIDER_LINE[0]![1], RIDER_LINE[2]![0], RIDER_LINE[2]![1]],
      access: 'own',
    });
    // одобренный свой — в каталоге и свой: доступ «свой»
    const ownApproved = await seedApprovedRiderRoute(h, ME);
    expect(await port().rideable(ownApproved, ME)).toMatchObject({ access: 'own' });

    expect(await port().matchGeometry(platform, ME)).toEqual({
      line: CORRIDOR.line,
      isLoop: false,
      distanceM: CORRIDOR.distanceM,
    });
    expect(await port().matchGeometry(own, ME)).toEqual({
      line: RIDER_LINE,
      isLoop: false,
      distanceM: 1300,
    });
  });

  it('не видимы: платформа не в каталоге, чужой непубличный, свой не готовый, чужой pending/hidden/withdrawn, catalog без approved, неизвестный', async () => {
    const hidden = [
      await corridorRoute(h, ME),
      await seedRiderRoute(h, OTHER),
      await seedRiderRoute(h, ME, { status: 'processing' }),
      await seedRiderRoute(h, ME, { status: 'failed' }),
      await seedRiderRoute(h, OTHER, { publication: publicationDoc(h, 'pending') }),
      await seedRiderRoute(h, OTHER, { publication: publicationDoc(h, 'hidden') }),
      await seedRiderRoute(h, OTHER, { publication: publicationDoc(h, 'withdrawn') }),
      // N1: подставленный catalog без approved — защита в глубину
      await seedRiderRoute(h, OTHER, { catalog: catalogDoc() }),
      UNKNOWN,
    ];
    for (const id of hidden) {
      expect(await port().rideable(id, ME), id).toBeNull();
      expect(await port().matchGeometry(id, ME), id).toBeNull();
    }
  });

  it('без кэша: снятие с публикации и удаление видны следующим вызовом; нет геометрии — null', async () => {
    const platform = await corridorRoute(h, OTHER);
    await inCatalog(platform);
    expect(await port().rideable(platform, ME)).not.toBeNull();
    expect(await port().matchGeometry(platform, ME)).not.toBeNull();
    await routesDb(h).routes.updateOne({ _id: platform }, { $set: { catalog: null } });
    expect(await port().rideable(platform, ME)).toBeNull();
    expect(await port().matchGeometry(platform, ME)).toBeNull();

    const own = await seedRiderRoute(h, ME);
    await routesDb(h).geometries.deleteOne({ _id: own });
    expect(await port().rideable(own, ME)).toBeNull();
    expect(await port().matchGeometry(own, ME)).toBeNull();
  });
});

describe('RouteRideRoutes.rideableTitles (achievements, RC-3)', () => {
  it('названия видимых райдеру одним вызовом: каталог и свой готовый; чужой непубличный, не готовый, вне каталога, неизвестный — нет', async () => {
    const platform = await corridorRoute(h, OTHER);
    await inCatalog(platform);
    const approved = await seedApprovedRiderRoute(h, OTHER);
    const own = await seedRiderRoute(h, ME, { title: 'Свой' });
    const hidden = [
      await corridorRoute(h, ME),
      await seedRiderRoute(h, OTHER),
      await seedRiderRoute(h, ME, { status: 'processing' }),
      await seedRiderRoute(h, OTHER, { publication: publicationDoc(h, 'hidden') }),
      UNKNOWN,
    ];

    const titles = await port().rideableTitles([platform, approved, own, own, ...hidden], ME);
    expect(titles).toEqual(
      new Map([
        [platform, 'Эталонный коридор'],
        [approved, 'Мой маршрут'],
        [own, 'Свой'],
      ]),
    );
    // чужой свой маршрут не виден другому райдеру
    expect((await port().rideableTitles([own], OTHER)).size).toBe(0);
    expect(await port().rideableTitles([], ME)).toEqual(new Map());

    // без кэша: снятие с каталога видно следующим вызовом
    await routesDb(h).routes.updateOne({ _id: platform }, { $set: { catalog: null } });
    expect((await port().rideableTitles([platform], ME)).has(platform)).toBe(false);
  });
});

describe('RouteRideRoutes.ownReadyIds и rideableBounds (route-rides-03, автопроверка)', () => {
  it('ownReadyIds — только свои готовые маршруты райдера, новые → старые, предел', async () => {
    const first = await seedRiderRoute(h, ME);
    await seedRiderRoute(h, ME, { status: 'processing' });
    await seedRiderRoute(h, ME, { status: 'failed' });
    await seedRiderRoute(h, OTHER);
    await corridorRoute(h, ME);
    const second = await seedApprovedRiderRoute(h, ME);
    const third = await seedRiderRoute(h, ME);

    expect(await port().ownReadyIds(ME, 10)).toEqual([third, second, first]);
    expect(await port().ownReadyIds(ME, 2)).toEqual([third, second]);
    expect(await port().ownReadyIds(UNKNOWN, 10)).toEqual([]);
  });

  it('rideableBounds — каталог и свой готовый с рамкой линии показа; чужой непубличный, не готовый, без линии — нет', async () => {
    const platform = await corridorRoute(h, OTHER);
    await inCatalog(platform);
    const approved = await seedApprovedRiderRoute(h, OTHER);
    const own = await seedRiderRoute(h, ME);
    const noLine = await seedRiderRoute(h, ME);
    await routesDb(h).geometries.deleteOne({ _id: noLine });
    const hidden = [
      await corridorRoute(h, ME),
      await seedRiderRoute(h, OTHER),
      await seedRiderRoute(h, ME, { status: 'processing' }),
      await seedRiderRoute(h, OTHER, { publication: publicationDoc(h, 'hidden') }),
      noLine,
      UNKNOWN,
    ];

    const bounds = await port().rideableBounds([platform, approved, own, ...hidden], ME);
    expect([...bounds.keys()].sort()).toEqual([platform, approved, own].sort());
    expect(bounds.get(own)).toEqual([
      RIDER_LINE[0]![0],
      RIDER_LINE[0]![1],
      RIDER_LINE[2]![0],
      RIDER_LINE[2]![1],
    ]);
    expect(bounds.get(platform)).toEqual((await port().rideable(platform, ME))?.bounds);
    // свой маршрут другому райдеру не виден
    expect((await port().rideableBounds([own], OTHER)).size).toBe(0);
    expect(await port().rideableBounds([], ME)).toEqual(new Map());
  });
});

describe('RouteRideRoutes.catalogRoute (route-rides-04, O2, RC-6)', () => {
  it('маршрут платформы в каталоге и одобренный маршрут райдера (и у автора) — { id, title }', async () => {
    const platform = await corridorRoute(h, OTHER);
    await inCatalog(platform);
    const approved = await seedApprovedRiderRoute(h, ME);
    expect(await port().catalogRoute(platform)).toEqual({
      id: platform,
      title: 'Эталонный коридор',
    });
    expect(await port().catalogRoute(approved)).toEqual({
      id: approved,
      title: expect.any(String),
    });
  });

  it('свой неопубликованный, pending/hidden/withdrawn, не готовый, вне каталога, без длины, неизвестный — null', async () => {
    const lengthless = await corridorRoute(h, OTHER);
    await inCatalog(lengthless);
    await routesDb(h).routes.updateOne({ _id: lengthless }, { $set: { distanceM: null } });
    const notReady = await corridorRoute(h, OTHER);
    await inCatalog(notReady);
    await routesDb(h).routes.updateOne({ _id: notReady }, { $set: { status: 'processing' } });
    const hidden = [
      await corridorRoute(h, OTHER),
      await seedRiderRoute(h, ME),
      await seedRiderRoute(h, OTHER, { publication: publicationDoc(h, 'pending') }),
      await seedRiderRoute(h, OTHER, { publication: publicationDoc(h, 'hidden') }),
      await seedRiderRoute(h, OTHER, { publication: publicationDoc(h, 'withdrawn') }),
      await seedRiderRoute(h, OTHER, { catalog: catalogDoc() }),
      lengthless,
      notReady,
      UNKNOWN,
    ];
    for (const id of hidden) expect(await port().catalogRoute(id), id).toBeNull();
  });

  it('без кэша: снятие с каталога видно следующим вызовом', async () => {
    const platform = await corridorRoute(h, OTHER);
    await inCatalog(platform);
    expect(await port().catalogRoute(platform)).not.toBeNull();
    await routesDb(h).routes.updateOne({ _id: platform }, { $set: { catalog: null } });
    expect(await port().catalogRoute(platform)).toBeNull();
  });
});
