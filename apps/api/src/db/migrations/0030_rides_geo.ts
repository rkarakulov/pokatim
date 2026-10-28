import { CITY_CENTERS, CITY_CODES } from '@pokatim/contracts';
import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { RIDES_COLLECTIONS } from '../../modules/rides/rides.collection';

/** «Рядом» (05c): точка райда и время старта — `$geoWithin` ленты и выборка карты по городу и времени. */
export const RIDES_GEO_INDEX = {
  key: { geo: '2dsphere', startsAt: 1 },
  options: { name: 'rides_geo_feed_idx' },
} as const;

/**
 * Маршрут и точка «Рядом» райдов (05c): райды до 05c — без маршрута (`routeId: null`), точка — центр города
 * (`startPrecise: false`). Сначала бэкфилл, потом индекс. Expand-only, без транзакции, идемпотентна (условие —
 * отсутствие поля); после `0029_routes_publication`.
 */
export const ridesGeo: MongoMigration = {
  id: '0030_rides_geo',
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
  },
};
