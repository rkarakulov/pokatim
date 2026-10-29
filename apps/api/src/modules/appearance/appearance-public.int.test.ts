import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCookie, setCookies } from '../../../test/panel';
import { staff } from '../../../test/races';
import { appearanceCollections } from './appearance.collection';

/**
 * Публичное оформление приложения (app-themes D1, AC1): без входа, ровно `{ themeId, decor }`, без кэша браузера.
 * user-theme (RC-1): `themeId` — всегда `classic` для сборок до личной темы, документ настройки тему не задаёт.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

let ipCounter = 0;
const get = () =>
  call(h, 'GET', '/v1/appearance', undefined, {
    'x-forwarded-for': `203.0.113.${(ipCounter++ % 200) + 1}`,
  });

describe('GET /v1/appearance (AC1)', () => {
  it('без входа и без документа — classic; без кэша браузера (no-cache); без cookie', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ themeId: 'classic', decor: 'none' });
    // кэш 60 с давал перекраску новой SSR-страницы в прежнюю тему после смены в панели
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(setCookies(res)).toEqual([]);
  });

  it('документ с legacy themeId — всё равно classic, ровно два ключа (user-theme RC-1)', async () => {
    await appearanceCollections(h.db).settings.insertOne({
      _id: 'appearance',
      themeId: 'chrono',
      decor: 'halloween',
      version: 3,
      updatedAt: h.clock.now(),
    });
    const res = await get();
    expect(res.body).toEqual({ themeId: 'classic', decor: 'halloween' });
    expect(Object.keys(res.body as object)).toEqual(['themeId', 'decor']);
  });

  it('декор включён в панели — halloween, тема classic (halloween-decor AC1)', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const put = await call(
      h,
      'PUT',
      '/v1/admin/appearance',
      { decor: 'halloween', version: 0 },
      panelCookie(admin.token),
    );
    expect(put.status).toBe(200);
    expect((await get()).body).toEqual({ themeId: 'classic', decor: 'halloween' });
  });
});
