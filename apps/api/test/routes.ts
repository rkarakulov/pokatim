import { PanelRoute } from '@pokatim/contracts';

import { RouteProcessingProcessor } from '../src/modules/routes/route-processing.processor';
import { routesCollections } from '../src/modules/routes/routes.collection';
import type { Harness } from './harness';
import { panelCookie } from './panel';
import { fixture, type UploadResult } from './tracks';

export { expectedFixtures, fixture } from './tracks';

export const ROUTES = '/v1/admin/routes';

/** Коллекции модуля `routes` тестовой БД. */
export const routesDb = (h: Harness) => routesCollections(h.db);

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
