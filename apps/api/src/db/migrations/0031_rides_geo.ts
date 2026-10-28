import { CITY_CENTERS, CITY_CODES } from '@pokatim/contracts';
import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { RIDES_COLLECTIONS } from '../../modules/rides/rides.collection';
import { ROUTES_COLLECTIONS } from '../../modules/routes/routes.collection';

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
    for (const code of CITY_CODES) {
      await rides.updateMany(
        { cityCode: code, geo: { $exists: false } },
        {
          $set: {
            geo: { type: 'Point', coordinates: [...CITY_CENTERS[code]] },
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
