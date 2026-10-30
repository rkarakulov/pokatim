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
    ).resolves.toEqual({
      items: [{ ...card, city: 'unknown', author: { kind: 'team' } }],
      nextCursor: null,
    });
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
    // API до routes-03 — без elevation, gpxAvailable и exportFormats: дефолты (RC-10)
    await expect(detail.api.getCatalogRoute('a/b')).resolves.toEqual({
      ...card,
      author: { kind: 'team' },
      elevation: null,
      gpxAvailable: false,
      exportFormats: [],
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

  it('catalogRouteExportUrl — адрес файла формата без запроса, id экранируется (routes-formats)', () => {
    const client = app(200, {});
    expect(client.api.catalogRouteExportUrl('a/b', 'kml')).toBe(
      'https://api.test/v1/routes/a%2Fb/kml',
    );
    for (const format of ['gpx', 'kml', 'tcx'] as const) {
      expect(client.api.catalogRouteExportUrl(ID, format)).toBe(
        `https://api.test/v1/routes/${ID}/${format}`,
      );
    }
    expect(client.api.catalogRouteGpxUrl(ID)).toBe(client.api.catalogRouteExportUrl(ID, 'gpx'));
    expect(client.calls).toHaveLength(0);
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
    elevation: null,
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
    // API до routes-06 — без publication, canPublish и submissionsExhausted: дефолты
    await expect(api.uploadMyRoute('access', bytes, 'Кольцо & ко')).resolves.toEqual({
      ...myRoute,
      publication: null,
      canPublish: false,
      submissionsExhausted: false,
    });
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

describe('api-client: публикация маршрутов райдеров (routes-06)', () => {
  const publication = {
    status: 'pending',
    city: 'minsk',
    surfaces: ['asphalt'],
    showAuthorName: true,
    submittedAt: '2026-10-27T10:00:00.000Z',
    decidedAt: null,
    rejection: null,
  };
  const myRoute = {
    id: ID,
    title: 'Кольцо',
    status: 'ready',
    failure: null,
    distanceM: 1300,
    elevationGainM: null,
    isLoop: false,
    createdAt: '2026-10-27T10:00:00.000Z',
    publication,
    canPublish: false,
    submissionsExhausted: false,
  };

  it('submitMyRoutePublication и unpublishMyRoute — POST с Bearer вызова, тело заявки, MyRoute', async () => {
    const submit = app(200, myRoute);
    const body = { city: 'minsk' as const, surfaces: ['asphalt' as const], showAuthorName: true };
    await expect(submit.api.submitMyRoutePublication('access', 'a/b', body)).resolves.toEqual(
      myRoute,
    );
    expect(submit.calls[0]).toMatchObject({
      url: 'https://api.test/v1/routes/mine/a%2Fb/publish',
      method: 'POST',
      body,
    });
    expect(submit.calls[0]?.headers.get('authorization')).toBe('Bearer access');

    const unpublish = app(200, { ...myRoute, publication: null, canPublish: true });
    await expect(unpublish.api.unpublishMyRoute('access', ID)).resolves.toMatchObject({
      publication: null,
      canPublish: true,
    });
    expect(unpublish.calls[0]).toMatchObject({
      url: `https://api.test/v1/routes/mine/${ID}/unpublish`,
      method: 'POST',
    });
    expect(unpublish.calls[0]?.headers.get('authorization')).toBe('Bearer access');
  });

  it('getCatalogRouteViewer и reportCatalogRoute — Bearer вызова; listCatalogRoutes — author повтором ключа', async () => {
    const viewer = app(200, { canReport: true, reported: false });
    await expect(viewer.api.getCatalogRouteViewer('access', 'a/b')).resolves.toEqual({
      canReport: true,
      reported: false,
    });
    expect(viewer.calls[0]).toMatchObject({
      url: 'https://api.test/v1/routes/a%2Fb/me',
      method: 'GET',
    });
    expect(viewer.calls[0]?.headers.get('authorization')).toBe('Bearer access');

    const report = app(200, { canReport: false, reported: true });
    const body = { reason: 'private_area' as const, comment: 'Через двор' };
    await expect(report.api.reportCatalogRoute('access', ID, body)).resolves.toEqual({
      canReport: false,
      reported: true,
    });
    expect(report.calls[0]).toMatchObject({
      url: `https://api.test/v1/routes/${ID}/reports`,
      method: 'POST',
      body,
    });
    expect(report.calls[0]?.headers.get('authorization')).toBe('Bearer access');

    const list = app(200, {
      items: [{ ...card, author: { kind: 'rider', name: null } }],
      nextCursor: null,
    });
    await expect(
      list.api.listCatalogRoutes({ author: ['team', 'rider'], city: ['minsk'] }),
    ).resolves.toMatchObject({ items: [{ author: { kind: 'rider', name: null } }] });
    expect(list.calls[0]?.url).toBe(
      'https://api.test/v1/routes?author=team&author=rider&city=minsk',
    );
    expect(list.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('панель: очередь, карточка и пять действий — пути, тела, cookie; строгий разбор', async () => {
    const base = {
      id: ID,
      title: 'Кольцо',
      authorUserId: ID,
      status: 'pending',
      city: 'minsk',
      surfaces: ['asphalt'],
      distanceM: 1300,
      submittedAt: '2026-10-27T10:00:00.000Z',
      openReportCount: 0,
      lastReportAt: null,
      hiddenAt: null,
    };
    const row = { ...base, topReason: null };
    const detail = {
      ...base,
      showAuthorName: false,
      submissionCount: 1,
      decidedAt: null,
      approvedAt: null,
      rejection: null,
      reportRevision: 0,
      version: 0,
      elevationGainM: null,
      isLoop: false,
      line: [],
      elevation: null,
      reports: [],
    };
    const list = admin(200, { items: [row], nextCursor: null });
    await expect(list.api.listRiderRoutes({ state: 'reported', cursor: 'c' })).resolves.toEqual({
      items: [row],
      nextCursor: null,
    });
    expect(list.calls[0]).toMatchObject({
      url: '/v1/admin/rider-routes?state=reported&cursor=c',
      method: 'GET',
      credentials: 'same-origin',
    });
    const one = admin(200, detail);
    await expect(one.api.getRiderRoute('a/b')).resolves.toEqual(detail);
    expect(one.calls[0]?.url).toBe('/v1/admin/rider-routes/a%2Fb');

    const actions = [
      ['approveRiderRoute', 'approve', { version: 0, city: 'minsk', surfaces: ['asphalt'] }],
      ['rejectRiderRoute', 'reject', { version: 0, reason: 'duplicate', comment: 'Есть такой' }],
      ['hideRiderRoute', 'hide', { version: 1, reason: 'Опасно' }],
      ['restoreRiderRoute', 'restore', { version: 2, reason: 'Исправлено' }],
      [
        'dismissRiderRouteReports',
        'dismiss-reports',
        { version: 1, reason: 'Ложные', reportRevision: 2 },
      ],
    ] as const;
    for (const [method, path, body] of actions) {
      const client = admin(200, detail);
      await expect(
        (client.api[method] as (id: string, body: unknown) => Promise<unknown>)(ID, body),
      ).resolves.toEqual(detail);
      expect(client.calls[0], method).toMatchObject({
        url: `/v1/admin/rider-routes/${ID}/${path}`,
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
      expect(client.calls[0]?.headers.has('authorization')).toBe(false);
    }
    const broken = admin(200, { ...detail, status: 'withdrawn' });
    await expect(broken.api.getRiderRoute(ID)).rejects.toThrow();
  });
});
