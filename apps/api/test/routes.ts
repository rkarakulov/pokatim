import { MyRoute, PanelRoute } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { Binary } from 'mongodb';

import { RouteProcessingProcessor } from '../src/modules/routes/route-processing.processor';
import { type RouteDoc, routesCollections } from '../src/modules/routes/routes.collection';
import { RoutesRepository } from '../src/modules/routes/routes.repository';
import type { Harness } from './harness';
import { bearer } from './identity';
import { panelCookie } from './panel';
import { fixture, type UploadResult } from './tracks';

export { expectedFixtures, fixture } from './tracks';

export const ROUTES = '/v1/admin/routes';

/** Коллекции модуля `routes` тестовой БД. */
export const routesDb = (h: Harness) => routesCollections(h.db);

/** Репозиторий `routes` приложения стенда — для spy на чтения (кэш геометрии). */
export const routesRepository = (h: Harness) => h.app.get(RoutesRepository, { strict: false });

/** `POST /v1/admin/routes?title=` сырыми байтами (`application/octet-stream` по умолчанию) с cookie панели. */
export async function uploadRoute(
  h: Harness,
  token: string | undefined,
  bytes: Buffer,
  options: { title?: string | null; contentType?: string; headers?: Record<string, string> } = {},
): Promise<UploadResult> {
  const title = options.title === undefined ? 'Минское кольцо' : options.title;
  const query = title === null ? '' : `?title=${encodeURIComponent(title)}`;
  const response = await h.app.inject({
    method: 'POST',
    url: `${ROUTES}${query}`,
    headers: {
      'content-type': options.contentType ?? 'application/octet-stream',
      ...(token ? panelCookie(token) : {}),
      ...options.headers,
    },
    payload: bytes,
  });
  return {
    status: response.statusCode,
    body: response.body ? (JSON.parse(response.body) as unknown) : undefined,
    headers: response.headers,
  };
}

/** Маршрут из ответа `202`/`200` по контракту. */
export const parsedRoute = (result: UploadResult) => PanelRoute.parse(result.body);

/** Разбор маршрута задачей worker (как по событию outbox). */
export const processRoute = (h: Harness, routeId: string, finalAttempt = false) =>
  h.worker.get(RouteProcessingProcessor).processRoute(routeId, { finalAttempt });

/** Загрузить фикстуру и разобрать: id готового маршрута (тест знает, что успешно). */
export async function readyRoute(
  h: Harness,
  token: string,
  name = 'route-trk-no-time.gpx',
  title = 'Минское кольцо',
): Promise<string> {
  const res = await uploadRoute(h, token, fixture(name), { title });
  if (res.status !== 202 && res.status !== 200) {
    throw new Error(`маршрут: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const { id } = parsedRoute(res);
  const outcome = await processRoute(h, id);
  if (outcome !== 'ready' && outcome !== 'skipped') throw new Error(`разбор: ${outcome}`);
  return id;
}

/** Линия маршрута райдера прямой вставкой (≈ 1,3 км у Минска). */
export const RIDER_LINE: [number, number][] = [
  [27.55, 53.9],
  [27.56, 53.905],
  [27.57, 53.91],
];

/**
 * Маршрут райдера (`origin: 'rider'`, routes-02) прямой вставкой — подготовка отрицательных тестов изоляции:
 * готовый — с геометрией и исходником; `catalog` — подставленный вручную (защита в глубину).
 */
export async function seedRiderRoute(
  h: Harness,
  ownerUserId: string,
  seed: Partial<Pick<RouteDoc, 'status' | 'catalog' | 'title' | 'sha256'>> = {},
): Promise<string> {
  const id = uuidv7();
  const now = h.clock.now();
  const status = seed.status ?? 'ready';
  const ready = status === 'ready';
  await routesDb(h).routes.insertOne({
    _id: id,
    origin: 'rider',
    ownerUserId,
    title: seed.title ?? 'Мой маршрут',
    status,
    failure: status === 'failed' ? 'no_track' : null,
    attempts: 1,
    sha256: seed.sha256 ?? id,
    sizeBytes: 1000,
    distanceM: ready ? 1300 : null,
    elevationGainM: null,
    isLoop: ready ? false : null,
    start: ready ? { type: 'Point', coordinates: RIDER_LINE[0]! } : null,
    finish: ready ? { type: 'Point', coordinates: RIDER_LINE.at(-1)! } : null,
    catalog: seed.catalog ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await routesDb(h).sources.insertOne({ _id: id, bytes: new Binary(Buffer.from('<gpx/>')) });
  if (ready) {
    await routesDb(h).geometries.insertOne({
      _id: id,
      line: { type: 'LineString', coordinates: RIDER_LINE },
      matchLine: RIDER_LINE,
      sourcePointCount: RIDER_LINE.length,
    });
  }
  return id;
}

/** «Мои маршруты» приложения (routes-02). */
export const MY_ROUTES = '/v1/routes/mine';

/** `POST /v1/routes/mine?title=` сырыми байтами с access JWT приложения (без токена — без входа). */
export async function uploadMyRoute(
  h: Harness,
  accessToken: string | undefined,
  bytes: Buffer,
  title: string | null = 'Мой маршрут',
  ip = '198.51.100.20',
): Promise<UploadResult> {
  const query = title === null ? '' : `?title=${encodeURIComponent(title)}`;
  const response = await h.app.inject({
    method: 'POST',
    url: `${MY_ROUTES}${query}`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-forwarded-for': ip,
      ...(accessToken ? bearer(accessToken) : {}),
    },
    payload: bytes,
  });
  return {
    status: response.statusCode,
    body: response.body ? (JSON.parse(response.body) as unknown) : undefined,
    headers: response.headers,
  };
}

/** Свой маршрут из ответа по контракту приложения. */
export const parsedMyRoute = (result: { body: unknown }) => MyRoute.parse(result.body);
