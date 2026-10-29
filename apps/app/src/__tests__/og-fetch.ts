/**
 * Моки `fetch` SSR с OG-картинками (og-images): запросы `/v1/og/cards/...` отвечают по таблице версий (нет записи —
 * 404), остальные — ответом страницы. Счётчики запросов страницы — без OG.
 */
export const OG_VERSION = '0123456789abcdef';
export const BRAND_VERSION = 'fedcba9876543210';
export const BRAND_ALT =
  'Покатим — Гонки, маршруты, кофе-райды и календарь стартов в одном профиле';

export const isOgUrl = (url: string) => url.includes('/v1/og/');

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;

/** Запросы страницы (без OG) по порядку. */
export const pageCalls = (mock: FetchMock) =>
  mock.mock.calls.map(([url]) => url).filter((url) => !isOgUrl(url));

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/** Ответ OG по пути (`/v1/og/cards/<kind>/<id>` → версия) или 404. */
export function ogResponse(url: string, versions: Record<string, string>): Promise<Response> {
  const path = url.slice(url.indexOf('/v1/og/'));
  const version = versions[path];
  return version ? json(200, { version }) : json(404, { code: 'NOT_FOUND', message: 'x' });
}

/** Страница отвечает `status`/`body`, OG — по `versions`. */
export function respondWithOg(
  mock: FetchMock,
  status: number,
  body: unknown,
  versions: Record<string, string> = {},
) {
  mock.mockImplementation((url) => (isOgUrl(url) ? ogResponse(url, versions) : json(status, body)));
}

/** `og:image` и `twitter:card` ожидаемой меты. */
export const ogImageMeta = (url: string, alt: string) => ({
  images: [{ url, width: 1200, height: 630, alt, type: 'image/png' }],
});
