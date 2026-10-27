import { PanelRoute, PanelRoutePage } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { panel, panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import {
  fixture,
  parsedRoute,
  readyRoute,
  ROUTES,
  routesDb,
  seedRiderRoute,
  uploadRoute,
} from '../../../test/routes';
import { PanelAudit } from '../panel';

/**
 * Каталог маршрутов в панели (routes-01, AC1): публикация, правка, снятие (`POST :id/publish|unpublish`), права,
 * отказы по статусу, журнал и откат транзакции.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const publish = (token: string | undefined, id: string, body: unknown) =>
  panelCall(h, token, 'POST', `${ROUTES}/${id}/publish`, body);
const unpublish = (token: string | undefined, id: string) =>
  panelCall(h, token, 'POST', `${ROUTES}/${id}/unpublish`, {});
const routeDoc = (id: string) => routesDb(h).routes.findOne({ _id: id });
const auditOf = (id: string) =>
  panel(h).audit.find({ 'subject.id': id }).sort({ _id: 1 }).toArray();
const catalogAudit = async (id: string) =>
  (await auditOf(id)).filter((entry) => entry.action !== 'route.created');

describe('публикация в каталог (AC1)', () => {
  it('готовый → 200, catalog в PanelRoute и списке, журнал route.published без координат', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token);
    const now = h.clock.now();

    const res = await publish(org.token, id, { city: 'minsk', surfaces: ['asphalt', 'gravel'] });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const route = PanelRoute.parse(res.body);
    expect(route.catalog).toEqual({
      city: 'minsk',
      surfaces: ['asphalt', 'gravel'],
      publishedAt: now.toISOString(),
    });
    expect(route.line.length).toBeGreaterThanOrEqual(2);
    // routes-05: ответ публикации — тот же `view()`, с профилем высоты (ключ кэша страницы маршрута)
    expect(res.body).toHaveProperty('elevation');
    expect(route.elevation?.profile.length).toBeGreaterThanOrEqual(2);

    const list = PanelRoutePage.parse(
      (await panelCall(h, org.token, 'GET', `${ROUTES}?status=ready`)).body,
    );
    expect(list.items[0]?.catalog).toEqual(route.catalog);

    expect(await routeDoc(id)).toMatchObject({
      catalog: { city: 'minsk', surfaces: ['asphalt', 'gravel'], publishedAt: now },
    });
    const audit = await catalogAudit(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'route.published',
      actor: { kind: 'user', userId: org.userId },
      subject: { kind: 'route', id, label: 'Минское кольцо' },
      details: null,
    });
    expect(JSON.stringify(audit[0])).not.toMatch(/coordinates|27\.\d|53\.\d/);
  });

  it('правка города → route.catalog_updated { changedFields: [city] }, publishedAt прежний; те же значения — без журнала', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token);
    const publishedAt = h.clock.now();
    expect((await publish(org.token, id, { city: 'minsk', surfaces: ['asphalt'] })).status).toBe(
      200,
    );

    h.clock.advance(5 * MINUTE);
    const edited = await publish(org.token, id, { city: 'brest', surfaces: ['asphalt'] });
    expect(edited.status).toBe(200);
    expect(PanelRoute.parse(edited.body).catalog).toEqual({
      city: 'brest',
      surfaces: ['asphalt'],
      publishedAt: publishedAt.toISOString(),
    });

    h.clock.advance(MINUTE);
    const surfaces = await publish(org.token, id, {
      city: 'brest',
      surfaces: ['gravel', 'asphalt'],
    });
    expect(surfaces.status).toBe(200);

    const before = await routeDoc(id);
    h.clock.advance(MINUTE);
    const same = await publish(org.token, id, { city: 'brest', surfaces: ['asphalt', 'gravel'] });
    expect(same.status).toBe(200);
    expect(await routeDoc(id)).toEqual(before);

    const audit = await catalogAudit(id);
    expect(audit.map((entry) => [entry.action, entry.details])).toEqual([
      ['route.published', null],
      ['route.catalog_updated', { changedFields: ['city'] }],
      ['route.catalog_updated', { changedFields: ['surfaces'] }],
    ]);
  });

  it('снятие → route.unpublished, catalog: null; повтор снятия — 200 без журнала; повторная публикация — новый publishedAt', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token);

    const notPublished = await unpublish(org.token, id);
    expect(notPublished.status).toBe(200);
    expect(PanelRoute.parse(notPublished.body).catalog).toBeNull();
    expect(await catalogAudit(id)).toEqual([]);

    await publish(org.token, id, { city: 'minsk', surfaces: ['asphalt'] });
    h.clock.advance(MINUTE);
    const off = await unpublish(org.token, id);
    expect(off.status).toBe(200);
    expect(off.headers['cache-control']).toBe('no-store');
    expect(PanelRoute.parse(off.body).catalog).toBeNull();
    expect((await routeDoc(id))?.catalog).toBeNull();
    expect((await unpublish(org.token, id)).status).toBe(200);

    h.clock.advance(MINUTE);
    const again = h.clock.now();
    const republished = await publish(org.token, id, { city: 'minsk', surfaces: ['asphalt'] });
    expect(PanelRoute.parse(republished.body).catalog?.publishedAt).toBe(again.toISOString());

    expect((await catalogAudit(id)).map((entry) => entry.action)).toEqual([
      'route.published',
      'route.unpublished',
      'route.published',
    ]);
  });

  it('маршрут до 0020 (поля catalog нет) — читается как неопубликованный и публикуется', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token);
    await routesDb(h).routes.updateOne({ _id: id }, { $unset: { catalog: '' } });

    const read = await panelCall(h, org.token, 'GET', `${ROUTES}/${id}`);
    expect(PanelRoute.parse(read.body).catalog).toBeNull();
    expect((await unpublish(org.token, id)).status).toBe(200);
    expect((await publish(org.token, id, { city: 'minsk', surfaces: ['gravel'] })).status).toBe(
      200,
    );
  });
});

describe('отказы (AC1)', () => {
  it('свой processing и failed — 409 ROUTE_INVALID_STATE; чужой необработанный и неизвестный — 404', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const other = await staff(h, 'other@example.by', 'organizer');
    const processing = parsedRoute(await uploadRoute(h, org.token, fixture('route-rte.gpx'))).id;
    const body = { city: 'minsk', surfaces: ['asphalt'] };

    for (const res of [
      await publish(org.token, processing, body),
      await unpublish(org.token, processing),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'ROUTE_INVALID_STATE' });
    }
    await routesDb(h).routes.updateOne(
      { _id: processing },
      { $set: { status: 'failed', failure: 'unreadable' } },
    );
    const failed = await publish(org.token, processing, body);
    expect(failed.status).toBe(409);
    expect(failed.body).toMatchObject({ code: 'ROUTE_INVALID_STATE' });

    for (const res of [
      await publish(other.token, processing, body),
      await unpublish(other.token, processing),
      await publish(org.token, uuidv7(), body),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await routeDoc(processing))?.catalog).toBeNull();
    expect(await catalogAudit(processing)).toEqual([]);
  });

  it('невалидные id, тело, город, покрытия — 400; модератор — 403; без сессии — 401', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const mod = await staff(h, 'mod@example.by', 'moderator');
    const id = await readyRoute(h, org.token);

    expect(
      (await publish(org.token, 'not-a-uuid', { city: 'minsk', surfaces: ['asphalt'] })).status,
    ).toBe(400);
    expect((await unpublish(org.token, 'not-a-uuid')).status).toBe(400);
    for (const body of [
      {},
      { city: 'moscow', surfaces: ['asphalt'] },
      { city: 'Минск', surfaces: ['asphalt'] },
      { city: 'minsk', surfaces: [] },
      { city: 'minsk', surfaces: ['asphalt', 'asphalt'] },
      { city: 'minsk', surfaces: ['cobbles'] },
      { city: 'minsk', surfaces: ['asphalt'], title: 'Другое' },
    ]) {
      const res = await publish(org.token, id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }

    expect((await publish(mod.token, id, { city: 'minsk', surfaces: ['asphalt'] })).status).toBe(
      403,
    );
    expect((await unpublish(mod.token, id)).status).toBe(403);
    expect((await publish(undefined, id, { city: 'minsk', surfaces: ['asphalt'] })).status).toBe(
      401,
    );
    expect((await unpublish(undefined, id)).status).toBe(401);
    expect((await routeDoc(id))?.catalog).toBeNull();
  });

  it('сбой журнала — откат: catalog не изменился, записи нет', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token);
    const audit = h.app.get(PanelAudit, { strict: false });
    const spy = vi.spyOn(audit, 'append').mockRejectedValue(new Error('журнал недоступен'));
    try {
      expect((await publish(org.token, id, { city: 'minsk', surfaces: ['asphalt'] })).status).toBe(
        500,
      );
    } finally {
      spy.mockRestore();
    }
    expect((await routeDoc(id))?.catalog).toBeNull();
    expect(await catalogAudit(id)).toEqual([]);
  });
});

describe('изоляция маршрутов райдера (routes-02, RC-2)', () => {
  it('публикация и снятие маршрута райдера — 404 и автору-сотруднику; catalog остался null, журнала нет', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const rider = await seedRiderRoute(h, admin.userId);
    const res = await publish(admin.token, rider, { city: 'minsk', surfaces: ['asphalt'] });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect((await unpublish(admin.token, rider)).status).toBe(404);
    expect((await routeDoc(rider))?.catalog).toBeNull();
    expect(await auditOf(rider)).toEqual([]);
  });
});
