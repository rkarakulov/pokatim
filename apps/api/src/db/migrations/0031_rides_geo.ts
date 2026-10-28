import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { RIDES_COLLECTIONS } from '../../modules/rides/rides.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';

/**
 * Центры городов на момент миграции — снимок `CITY_CENTERS` контрактов: применённая миграция не меняется вслед за
 * справочником, и глобальная подготовка тестов загружает её без сборки `@pokatim/contracts`.
 */
export const CITY_CENTERS_0031: Readonly<Record<string, readonly [number, number]>> = {
  minsk: [27.559, 53.9006],
  brest: [23.7341, 52.0976],
  vitebsk: [30.2049, 55.1904],
  gomel: [30.9754, 52.4345],
  grodno: [23.8131, 53.6694],
  mogilev: [30.3449, 53.9168],
  baranovichi: [26.0139, 53.1327],
  bobruisk: [29.2214, 53.1384],
  borisov: [28.505, 54.2279],
  pinsk: [26.0951, 52.1229],
  orsha: [30.4172, 54.5081],
  mozyr: [29.2456, 52.0495],
  soligorsk: [27.5415, 52.7876],
  novopolotsk: [28.6534, 55.5346],
  lida: [25.2997, 53.8833],
  molodechno: [26.85, 54.3167],
  polotsk: [28.7856, 55.4879],
  zhlobin: [30.024, 52.8926],
  svetlogorsk: [29.7389, 52.6329],
  rechitsa: [30.3916, 52.3617],
  slutsk: [27.5597, 53.0274],
  zhodino: [28.3331, 54.0985],
  kobrin: [24.3564, 52.2138],
  slonim: [25.3163, 53.0869],
  volkovysk: [24.4513, 53.1561],
};

/** «Рядом» (05c): точка райда и время старта — `$geoWithin` ленты и выборка карты по городу и времени. */
export const RIDES_GEO_INDEX = {
  key: { geo: '2dsphere', startsAt: 1 },
  options: { name: 'rides_geo_feed_idx' },
} as const;

/**
 * Старты маршрутов (05c, фиксы ревью pass 2): кандидаты «Рядом» с точной точкой — только райды на маршрутах каталога со
 * стартом в круге (`RideRoutes.publicStartsWithin`). Без старта (не `ready`) — вне индекса.
 */
export const ROUTES_START_INDEX = {
  key: { start: '2dsphere' },
  options: { name: 'routes_start_2dsphere' },
} as const;

/**
 * Маршрут и точка «Рядом» райдов (05c): райды до 05c — без маршрута (`routeId: null`), точка — центр города
 * (`startPrecise: false`). Сначала бэкфилл, потом индексы (`rides.geo`, `routes.start`). Expand-only, без транзакции, идемпотентна (условие —
 * отсутствие поля); после `0030_standings`.
 */
export const ridesGeo: MongoMigration = {
  id: '0031_rides_geo',
  async up(db) {
    const rides = db.collection(RIDES_COLLECTIONS.rides);
    for (const [code, center] of Object.entries(CITY_CENTERS_0031)) {
      await rides.updateMany(
        { cityCode: code, geo: { $exists: false } },
        {
          $set: {
            geo: { type: 'Point', coordinates: [...center] },
            startPrecise: false,
          },
        },
      );
    }
    await rides.updateMany({ routeId: { $exists: false } }, { $set: { routeId: null } });
    await rides.createIndex(RIDES_GEO_INDEX.key, RIDES_GEO_INDEX.options);
    await db
      .collection(ROUTES_COLLECTIONS.routes)
      .createIndex(ROUTES_START_INDEX.key, ROUTES_START_INDEX.options);
  },
};
