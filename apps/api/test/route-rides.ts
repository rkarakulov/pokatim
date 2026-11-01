import type { CorridorGeometry } from '@pokatim/tracks';
import type { OutboxJobData } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import { Binary } from 'mongodb';

import { RouteRideAutoProcessor } from '../src/modules/route-rides/route-ride-auto.processor';
import { RouteRideCheckProcessor } from '../src/modules/route-rides/route-ride-check.processor';
import { RouteRidesIntakeProcessor } from '../src/modules/route-rides/route-rides-intake.processor';
import {
  type RouteRideDoc,
  routeRidesCollections,
} from '../src/modules/route-rides/route-rides.collection';
import { routeRidesOutboxRoutes } from '../src/modules/route-rides/route-rides.events';
import { RouteRidesRepository } from '../src/modules/route-rides/route-rides.repository';
import { QUEUE } from '../src/queues';
import type { RoutePublicationDoc } from '../src/modules/routes/routes.collection';
import { seedActivity } from './achievements';
import type { Harness } from './harness';
import { outboxEvents } from './identity';
import { CORRIDOR, corridorRoute } from './results';
import { routesDb } from './routes';

/** Коллекции модуля `route-rides` тестовой БД. */
export const routeRidesDb = (h: Harness) => routeRidesCollections(h.db);

/** Репозиторий `route-rides` worker стенда (запись итога проверки в тестах источников). */
export const routeRidesRepository = (h: Harness) =>
  h.worker.get(RouteRidesRepository, { strict: false });

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

/** Длинные маршруты участков (route-rides-05): линия 25,5 км на север или «туда-обратно» 2 × 15 км. */
export type LongRouteKind = 'line' | 'outAndBack';

/** Метров в градусе меридиана (сфера `haversineMeters`). */
const M_LAT = (6_371_008.8 * Math.PI) / 180;
const [LON0, LAT0] = CORRIDOR.line[0]!;
const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
/** Точка [lon, lat] по смещению в метрах от старта эталона (x — восток, y — север). */
const lonLatOf = ([x, y]: [number, number]): [number, number] => [
  LON0 + x / M_LON,
  LAT0 + y / M_LAT,
];

/** Ломаная по углам с вершинами раз в 100 м. */
function densePath(corners: readonly [number, number][]): [number, number][] {
  const points: [number, number][] = [corners[0]!];
  for (let i = 1; i < corners.length; i += 1) {
    const [ax, ay] = corners[i - 1]!;
    const [bx, by] = corners[i]!;
    const length = Math.hypot(bx - ax, by - ay);
    for (let d = 100; d < length; d += 100) {
      points.push([ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length]);
    }
    points.push(corners[i]!);
  }
  return points;
}

const LONG_ROUTES: Record<LongRouteKind, { corners: [number, number][]; isLoop: boolean }> = {
  // участки 0–10, 10–20, 20–25,5 км
  line: {
    corners: [
      [0, 0],
      [0, 25_500],
    ],
    isLoop: false,
  },
  // участок с разворотом проходит у своих ворот — слияния до одного участка, участков нет (§8.2 Q1)
  outAndBack: {
    corners: [
      [0, 0],
      [0, 15_000],
      [0, 0],
    ],
    isLoop: true,
  },
};

/** Геометрия длинного маршрута (линия сверки = линия показа). */
export function longGeometry(kind: LongRouteKind): Omit<CorridorGeometry, 'widthM'> {
  const { corners, isLoop } = LONG_ROUTES[kind];
  const line = densePath(corners).map(lonLatOf);
  let distanceM = 0;
  for (let i = 1; i < corners.length; i += 1) {
    distanceM += Math.hypot(
      corners[i]![0] - corners[i - 1]![0],
      corners[i]![1] - corners[i - 1]![1],
    );
  }
  return { line, isLoop, distanceM };
}

/** Маршрут команды в каталоге с длинной линией (≥ 25 км, есть участки). */
export async function longCorridorRoute(
  h: Harness,
  ownerUserId: string,
  kind: LongRouteKind = 'line',
): Promise<string> {
  const id = await corridorRoute(h, ownerUserId, longGeometry(kind));
  await routesDb(h).routes.updateOne(
    { _id: id },
    { $set: { catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() } } },
  );
  return id;
}

/**
 * Синтетический GPX заезда по длинному маршруту (без фикстур-файлов): с 95 м до старта через весь маршрут и 95 м за
 * финиш (у «туда-обратно» — в сторону), точка раз в 5 с, 8 м/с; `stopAtM` — остановка на этом метре маршрута.
 */
export function longRideGpx(
  kind: LongRouteKind,
  startAt: Date,
  { stopAtM }: { stopAtM?: number } = {},
): Buffer {
  const { corners } = LONG_ROUTES[kind];
  const path: [number, number][] = [[0, -95], ...corners];
  const [ex, ey] = corners.at(-1)!;
  path.push(kind === 'line' ? [ex, ey + 95] : [ex - 95, ey]);
  const lengths = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const end = stopAtM === undefined ? total : Math.min(total, stopAtM + 95);
  const at = (along: number): [number, number] => {
    let rest = along;
    for (let i = 0; i < lengths.length; i += 1) {
      if (rest <= lengths[i]! || i === lengths.length - 1) {
        const u = rest / lengths[i]!;
        const [ax, ay] = path[i]!;
        const [bx, by] = path[i + 1]!;
        return [ax + (bx - ax) * u, ay + (by - ay) * u];
      }
      rest -= lengths[i]!;
    }
    return path[0]!;
  };
  const points: string[] = [];
  for (let k = 0; k * 40 <= end; k += 1) {
    const [lon, lat] = lonLatOf(at(k * 40));
    const time = new Date(startAt.getTime() + k * 5000).toISOString();
    points.push(
      `<trkpt lat="${lat.toFixed(8)}" lon="${lon.toFixed(8)}"><time>${time}</time></trkpt>`,
    );
  }
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="pokatim tests" xmlns="http://www.topografix.com/GPX/1/1">' +
      `<trk><name>Длинный заезд</name><type>cycling</type><trkseg>${points.join('')}</trkseg></trk></gpx>`,
  );
}

/** Задача outbox для прямого вызова процессора `route-rides`. */
export const outboxJob = (name: string, outboxEventId: string, attemptsMade = 0) =>
  ({
    name,
    data: { outboxEventId },
    attemptsMade,
    opts: { attempts: 5 },
  }) as unknown as Job<OutboxJobData>;

const GROUP_CREATED = 'tracks.activity-group-created';

/**
 * Обработчик событий outbox `route-rides` в тесте (как публикатор + worker): события маршрутов модуля по порядку записи
 * в процессор своей очереди (сверка — `route-ride-check`, `tracks.activity-removed` — `route-rides-intake`,
 * автопроверка — `route-ride-auto`), каждое событие — один раз. События гонок не трогает. Автопроверка новой активности
 * (`tracks.activity-group-created`, route-rides-03) — только с `{ auto: true }`: прежние тесты автозаездов не получают.
 */
export function routeRidesWorker(h: Harness, { auto = false }: { auto?: boolean } = {}) {
  const handled = new Set<string>();
  const types = Object.keys(routeRidesOutboxRoutes).filter(
    (type) => auto || type !== GROUP_CREATED,
  );
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
          const queue = (routeRidesOutboxRoutes as Record<string, string>)[event.type];
          const processor =
            queue === QUEUE.routeRidesIntake
              ? h.worker.get(RouteRidesIntakeProcessor)
              : queue === QUEUE.routeRideAuto
                ? h.worker.get(RouteRideAutoProcessor)
                : h.worker.get(RouteRideCheckProcessor);
          await processor.process(outboxJob(event.type, event._id));
        }
      }
    },
  };
}

/** События проверки заездов в outbox. */
export const checkEvents = async (h: Harness) =>
  (await outboxEvents(h)).filter((event) => event.type === 'route-rides.check-requested');

/** События автопроверки (`tracks.activity-group-created`) в outbox. */
export const autoEvents = async (h: Harness) =>
  (await outboxEvents(h)).filter((event) => event.type === GROUP_CREATED);

/** Заезд маршрута прямой вставкой поверх новой живой активности (`seedActivity`); время сегмента — `elapsedSec`. */
export async function seedRouteRide(
  h: Harness,
  userId: string,
  routeId: string,
  elapsedSec: number,
  startedAt: Date,
  overrides: Partial<RouteRideDoc> = {},
): Promise<{ rideId: string; activityId: string }> {
  const activityId = await seedActivity(h, userId, startedAt);
  const rideId = uuidv7();
  const status = overrides.status ?? 'passed';
  await routeRidesDb(h).rides.insertOne({
    _id: rideId,
    userId: userId,
    routeId,
    activityId,
    activity: {
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3_600_000),
      source: 'upload',
      elapsedSec: 3600,
      distanceM: 8000,
    },
    origin: 'manual',
    corridorWidthM: 50,
    status,
    checkRevision: 1,
    checkAttempts: 1,
    reasons: status === 'not_passed' ? ['no_finish'] : [],
    failure: status === 'failed' ? 'error' : null,
    segment:
      status === 'passed'
        ? {
            startedAt,
            finishedAt: new Date(startedAt.getTime() + elapsedSec * 1000),
            elapsedSec,
            distanceM: 8000,
            offCorridorM: 0,
            offCorridorShare: 0,
            maxExcursionM: 0,
            coverage: 1,
          }
        : null,
    touchedCorridor: status === 'passed' ? true : null,
    engineVersion: 1,
    trackMap: null,
    createdAt: h.clock.now(),
    updatedAt: h.clock.now(),
    checkedAt: h.clock.now(),
    ...overrides,
  });
  return { rideId, activityId };
}
