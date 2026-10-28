import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import { Binary } from 'mongodb';

import { RouteRideCheckProcessor } from '../src/modules/route-rides/route-ride-check.processor';
import { routeRidesCollections } from '../src/modules/route-rides/route-rides.collection';
import { routeRidesOutboxRoutes } from '../src/modules/route-rides/route-rides.events';
import type { RoutePublicationDoc } from '../src/modules/routes/routes.collection';
import type { Harness } from './harness';
import { outboxEvents } from './identity';
import { CORRIDOR, corridorRoute } from './results';
import { routesDb } from './routes';

/** Коллекции модуля `route-rides` тестовой БД. */
export const routeRidesDb = (h: Harness) => routeRidesCollections(h.db);

/** Путь заездов маршрута: `/v1/routes/:routeId/rides{path}`. */
export const ridesUrl = (routeId: string, path = '') => `/v1/routes/${routeId}/rides${path}`;

/** Маршрут команды с линией эталона (`clean.gpx`, 8 км) — в каталоге. */
export async function catalogCorridorRoute(h: Harness, ownerUserId: string): Promise<string> {
  const id = await corridorRoute(h, ownerUserId);
  await routesDb(h).routes.updateOne(
    { _id: id },
    {
      $set: {
        catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() },
      },
    },
  );
  return id;
}

/**
 * Маршрут райдера (`origin: 'rider'`) с линией эталона прямой вставкой: свой готовый — по умолчанию; `status`,
 * `publication`, `catalog` — для тестов видимости.
 */
export async function ownCorridorRoute(
  h: Harness,
  ownerUserId: string,
  seed: {
    status?: 'processing' | 'ready' | 'failed';
    publication?: RoutePublicationDoc;
    catalog?: { city: 'minsk'; surfaces: ['asphalt']; publishedAt: Date };
  } = {},
): Promise<string> {
  const id = uuidv7();
  const now = h.clock.now();
  const status = seed.status ?? 'ready';
  const ready = status === 'ready';
  await routesDb(h).routes.insertOne({
    _id: id,
    origin: 'rider',
    ownerUserId,
    title: 'Мой коридор',
    status,
    failure: status === 'failed' ? 'no_track' : null,
    attempts: 1,
    sha256: id,
    sizeBytes: 1000,
    distanceM: ready ? CORRIDOR.distanceM : null,
    elevationGainM: null,
    isLoop: ready ? CORRIDOR.isLoop : null,
    start: ready ? { type: 'Point', coordinates: CORRIDOR.line[0]! } : null,
    finish: ready ? { type: 'Point', coordinates: CORRIDOR.line.at(-1)! } : null,
    catalog: seed.catalog ?? null,
    ...(seed.publication ? { publication: seed.publication } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await routesDb(h).sources.insertOne({ _id: id, bytes: new Binary(Buffer.from('<gpx/>')) });
  if (ready) {
    await routesDb(h).geometries.insertOne({
      _id: id,
      line: { type: 'LineString', coordinates: CORRIDOR.line },
      matchLine: CORRIDOR.line,
      sourcePointCount: CORRIDOR.line.length,
    });
  }
  return id;
}

const job = (name: string, outboxEventId: string, attemptsMade = 0) =>
  ({
    name,
    data: { outboxEventId },
    attemptsMade,
    opts: { attempts: 5 },
  }) as unknown as Job<OutboxJobData>;

/**
 * Обработчик событий outbox `route-rides` в тесте (как публикатор + worker): проверки заездов по порядку записи, каждое
 * событие — один раз. События гонок не трогает.
 */
export function routeRidesWorker(h: Harness) {
  const handled = new Set<string>();
  const types = Object.keys(routeRidesOutboxRoutes);
  return {
    handled,
    async drain(): Promise<number> {
      let processed = 0;
      for (;;) {
        const events = (await outboxEvents(h)).filter(
          (event) => types.includes(event.type) && !handled.has(event._id),
        );
        if (events.length === 0) return processed;
        for (const event of events) {
          handled.add(event._id);
          processed += 1;
          await h.worker.get(RouteRideCheckProcessor).process(job(event.type, event._id));
        }
      }
    },
  };
}

/** События проверки заездов в outbox. */
export const checkEvents = async (h: Harness) =>
  (await outboxEvents(h)).filter((event) => event.type === 'route-rides.check-requested');
