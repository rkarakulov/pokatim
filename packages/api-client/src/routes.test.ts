import { describe, expect, it } from 'vitest';

import { createAdminApiClient } from './admin.ts';
import { ApiHttpError, createApiClient } from './index.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

interface Call {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  headers: Headers;
  body: unknown;
}

function stub(status: number, response: unknown) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      credentials: init?.credentials,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(new Response(JSON.stringify(response), { status }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** Клиент приложения с access-токеном в памяти: публичные методы его не отправляют. */
const app = (status: number, response: unknown) => {
  const { calls, fetchImpl } = stub(status, response);
  return {
    calls,
    api: createApiClient({ baseUrl: 'https://api.test', fetchImpl, getAccessToken: () => 'jwt' }),
  };
};

const admin = (status: number, response: unknown) => {
  const { calls, fetchImpl } = stub(status, response);
  return { calls, api: createAdminApiClient({ baseUrl: '', fetchImpl }) };
};

const card = {
  id: ID,
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 412,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2026-10-27T10:00:00.000Z',
};

const geometry = {
  line: [
    [27.55, 53.9],
    [27.56, 53.91],
  ],
  start: [27.55, 53.9],
  finish: [27.56, 53.91],
  bounds: [27.55, 53.9, 27.56, 53.91],
};

describe('каталог маршрутов (routes-01): публичные методы', () => {
  it('listCatalogRoutes — массивы фильтров повтором ключа, курсор, лимит; без токена; tolerantEnum', async () => {
    const list = app(200, { items: [{ ...card, city: 'kaunas' }], nextCursor: null });
    await expect(
      list.api.listCatalogRoutes({
        city: ['minsk', 'brest'],
        distance: ['lt50', 'gt100'],
        surface: ['gravel'],
        cursor: 'c 1',
        limit: 10,
      }),
    ).resolves.toEqual({ items: [{ ...card, city: 'unknown' }], nextCursor: null });
    const empty = app(200, { items: [], nextCursor: null });
    await empty.api.listCatalogRoutes();
    expect([list, empty].map((client) => client.calls[0]?.url)).toEqual([
      'https://api.test/v1/routes?city=minsk&city=brest&distance=lt50&distance=gt100&surface=gravel&cursor=c+1&limit=10',
      'https://api.test/v1/routes',
    ]);
    for (const client of [list, empty]) {
      expect(client.calls[0]?.method).toBe('GET');
      expect(client.calls[0]?.headers.has('authorization')).toBe(false);
    }
  });

  it('города, карточка, карта, гонки маршрута — пути с encodeURIComponent, без токена', async () => {
    const cities = app(200, { cities: ['minsk', 'kaunas'] });
    await expect(cities.api.listCatalogRouteCities()).resolves.toEqual({ cities: ['minsk'] });
    const detail = app(200, card);
    // API до routes-03 — без elevation и gpxAvailable: дефолты (RC-10)
    await expect(detail.api.getCatalogRoute('a/b')).resolves.toEqual({
      ...card,
      elevation: null,
      gpxAvailable: false,
    });
    const map = app(200, geometry);
    await expect(map.api.getCatalogRouteMap('a/b')).resolves.toEqual(geometry);
    const races = app(200, { items: [], nextCursor: null });
    await races.api.listCatalogRouteRaces('a/b', { limit: 10, cursor: 'x' });
    const racesDefault = app(200, { items: [], nextCursor: null });
    await racesDefault.api.listCatalogRouteRaces(ID);

    const clients = [cities, detail, map, races, racesDefault];
    expect(clients.map((client) => client.calls[0]?.url)).toEqual([
      'https://api.test/v1/routes/cities',
      'https://api.test/v1/routes/a%2Fb',
      'https://api.test/v1/routes/a%2Fb/map',
      'https://api.test/v1/routes/a%2Fb/races?limit=10&cursor=x',
      `https://api.test/v1/routes/${ID}/races`,
    ]);
    for (const client of clients) {
      expect(client.calls[0]?.method).toBe('GET');
      expect(client.calls[0]?.headers.has('authorization')).toBe(false);
    }
  });

  it('catalogRouteGpxUrl — адрес файла GPX без запроса, id экранируется', () => {
    const client = app(200, {});
    expect(client.api.catalogRouteGpxUrl('a/b')).toBe('https://api.test/v1/routes/a%2Fb/gpx');
    expect(client.api.catalogRouteGpxUrl(ID)).toBe(`https://api.test/v1/routes/${ID}/gpx`);
    expect(client.calls).toHaveLength(0);
  });

  it('404 — ApiHttpError; карта с одной точкой — ошибка разбора', async () => {
    const missing = app(404, { code: 'NOT_FOUND', message: 'Не найдено' });
    const error: unknown = await missing.api.getCatalogRoute(ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect(error).toMatchObject({ status: 404 });
    const broken = app(200, { ...geometry, line: [[27.55, 53.9]] });
    await expect(broken.api.getCatalogRouteMap(ID)).rejects.toThrow();
  });
});

describe('каталог маршрутов (routes-01): панель', () => {
  const panelRoute = {
    id: ID,
    title: 'Минское кольцо',
    status: 'ready',
    failure: null,
    distanceM: 86_012,
    elevationGainM: 412,
    isLoop: true,
    owner: { userId: ID, displayName: 'Ольга' },
    createdAt: '2026-10-27T10:00:00.000Z',
    catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: '2026-10-27T11:00:00.000Z' },
    line: [
      [27.5, 53.9],
      [27.6, 53.95],
    ],
  };

  it('publishRoute и unpublishRoute — POST с телом, cookie панели, строгий разбор', async () => {
    const publish = admin(200, panelRoute);
    const body = { city: 'minsk' as const, surfaces: ['asphalt' as const] };
    await expect(publish.api.publishRoute('a/b', body)).resolves.toEqual(panelRoute);
    expect(publish.calls[0]).toMatchObject({
      url: '/v1/admin/routes/a%2Fb/publish',
      method: 'POST',
      credentials: 'same-origin',
      body,
    });
    expect(publish.calls[0]?.headers.has('authorization')).toBe(false);

    const unpublish = admin(200, { ...panelRoute, catalog: null });
    await expect(unpublish.api.unpublishRoute(ID)).resolves.toMatchObject({ catalog: null });
    expect(unpublish.calls[0]).toMatchObject({
      url: `/v1/admin/routes/${ID}/unpublish`,
      method: 'POST',
      credentials: 'same-origin',
    });

    const broken = admin(200, {
      ...panelRoute,
      catalog: { ...panelRoute.catalog, city: 'kaunas' },
    });
    await expect(broken.api.publishRoute(ID, body)).rejects.toThrow();
  });
});

describe('api-client: мои маршруты (routes-02, Bearer — только явным параметром)', () => {
  const myRoute = {
    id: ID,
    title: 'Кольцо',
    status: 'processing',
    failure: null,
    distanceM: null,
    elevationGainM: null,
    isLoop: null,
    createdAt: '2026-10-27T10:00:00.000Z',
  };

  it('uploadMyRoute — POST octet-stream, ?title= с кириллицей; myRouteUploadRequest — те же путь и заголовки', async () => {
    const { calls, api } = app(202, myRoute);
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(api.uploadMyRoute('access', bytes, 'Кольцо & ко')).resolves.toEqual(myRoute);
    expect(calls[0]?.url).toBe(
      'https://api.test/v1/routes/mine?title=%D0%9A%D0%BE%D0%BB%D1%8C%D1%86%D0%BE+%26+%D0%BA%D0%BE',
    );
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer access');
    expect(calls[0]?.headers.get('content-type')).toBe('application/octet-stream');
    expect(api.myRouteUploadRequest('access', 'a b')).toEqual({
      url: 'https://api.test/v1/routes/mine?title=a+b',
      method: 'POST',
      headers: { authorization: 'Bearer access', 'content-type': 'application/octet-stream' },
    });
  });

  it('listMyRoutes, getMyRoute, getMyRouteMap — пути, encodeURIComponent, Bearer вызова', async () => {
    const list = app(200, { items: [myRoute], nextCursor: null });
    await list.api.listMyRoutes('access', { limit: 20, cursor: 'c' });
    expect(list.calls[0]?.url).toBe('https://api.test/v1/routes/mine?limit=20&cursor=c');
    expect(list.calls[0]?.headers.get('authorization')).toBe('Bearer access');

    const one = app(200, myRoute);
    await one.api.getMyRoute('access', 'a/b');
    expect(one.calls[0]?.url).toBe('https://api.test/v1/routes/mine/a%2Fb');

    const map = app(200, {
      line: [
        [27.5, 53.9],
        [27.6, 53.95],
      ],
      start: [27.5, 53.9],
      finish: [27.6, 53.95],
      bounds: [27.5, 53.9, 27.6, 53.95],
    });
    await map.api.getMyRouteMap('access', ID);
    expect(map.calls[0]?.url).toBe(`https://api.test/v1/routes/mine/${ID}/map`);
    expect(map.calls[0]?.headers.get('authorization')).toBe('Bearer access');
  });

  it('renameMyRoute — POST …/rename с телом; deleteMyRoute — POST …/delete → 204; 404 — ApiHttpError', async () => {
    const rename = app(200, { ...myRoute, title: 'Новое' });
    await expect(rename.api.renameMyRoute('access', ID, { title: 'Новое' })).resolves.toMatchObject(
      { title: 'Новое' },
    );
    expect(rename.calls[0]).toMatchObject({
      url: `https://api.test/v1/routes/mine/${ID}/rename`,
      method: 'POST',
      body: { title: 'Новое' },
    });
    expect(rename.calls[0]?.headers.get('authorization')).toBe('Bearer access');

    const { calls, fetchImpl } = stub(204, undefined);
    const api = createApiClient({ baseUrl: 'https://api.test', fetchImpl });
    await expect(api.deleteMyRoute('access', ID)).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({
      url: `https://api.test/v1/routes/mine/${ID}/delete`,
      method: 'POST',
    });

    const missing = app(404, { code: 'NOT_FOUND', message: 'x' });
    const error = await missing.api.getMyRoute('access', ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpError);
    expect((error as ApiHttpError).apiError.code).toBe('NOT_FOUND');
  });
});
