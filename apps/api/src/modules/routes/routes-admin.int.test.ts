import { PanelRoutePage, Session } from '@pokatim/contracts';
import { parseGpx, ROUTE_DERIVED_VERSION } from '@pokatim/tracks/parse';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { bearer, outboxEvents, signUpSession } from '../../../test/identity';
import { panel, panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import {
  expectedFixtures,
  fixture,
  parsedRoute,
  processRoute,
  readyRoute,
  ROUTES,
  routesDb,
  uploadRoute,
} from '../../../test/routes';
import { RouteProcessingProcessor } from './route-processing.processor';
import { ROUTE_RECEIVED } from './routes.events';
import { RoutesRepository } from './routes.repository';

/**
 * Маршруты коридора (race-results-01: AC1, AC2, AC10, AC14, AC16): права, приём GPX, дедуп, разбор в worker
 * (`processRoute` напрямую — как задача по событию outbox), отказы, видимость, журнал.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
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

/** Прямая на восток от (27.5, 53.9): GPX `trk` без времени. */
const straightGpx = (count: number, stepDeg: number) =>
  Buffer.from(
    `<gpx><trk><trkseg>${Array.from(
      { length: count },
      (_, i) => `<trkpt lat="53.9" lon="${(27.5 + i * stepDeg).toFixed(6)}"/>`,
    ).join('')}</trkseg></trk></gpx>`,
  );

const routeDoc = (id: string) => routesDb(h).routes.findOne({ _id: id });

describe('права на маршруты (AC14)', () => {
  it('без сессии — 401; access JWT приложения — 401; модератор: список и чтение — да, загрузка — 403', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const id = await readyRoute(h, admin.token);
    const mod = await staff(h, 'mod@example.by', 'moderator');

    expect((await uploadRoute(h, undefined, fixture('route-rte.gpx'))).status).toBe(401);
    expect((await panelCall(h, undefined, 'GET', ROUTES)).status).toBe(401);
    expect((await panelCall(h, undefined, 'GET', `${ROUTES}/${id}`)).status).toBe(401);

    const session = Session.parse(await signUpSession(h, 'rider@example.com'));
    const app = await uploadRoute(h, undefined, fixture('route-rte.gpx'), {
      headers: bearer(session.accessToken),
    });
    expect(app.status).toBe(401);

    expect((await panelCall(h, mod.token, 'GET', ROUTES)).status).toBe(200);
    expect((await panelCall(h, mod.token, 'GET', `${ROUTES}/${id}`)).status).toBe(200);
    const denied = await uploadRoute(h, mod.token, fixture('route-rte.gpx'));
    expect(denied.status).toBe(403);
    expect(await routesDb(h).routes.countDocuments()).toBe(1);
  });
});

describe('приём и разбор (AC1, AC9, AC10)', () => {
  it('202 processing → журнал route.created и outbox; worker → ready с геометрией; повтор файла — 200 тот же', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const first = await uploadRoute(h, org.token, fixture('route-trk-no-time.gpx'), {
      title: '  Минское кольцо ',
    });
    expect(first.status).toBe(202);
    const route = parsedRoute(first);
    expect(route).toMatchObject({
      title: 'Минское кольцо',
      status: 'processing',
      failure: null,
      distanceM: null,
      line: [],
      owner: { userId: org.userId, displayName: 'Сотрудник organizer' },
    });
    expect(first.body).not.toHaveProperty('sha256');

    const audit = await panel(h).audit.find({ action: 'route.created' }).toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: { kind: 'user', userId: org.userId },
      subject: { kind: 'route', id: route.id, label: 'Минское кольцо' },
    });
    const events = (await outboxEvents(h)).filter((event) => event.type === ROUTE_RECEIVED);
    expect(events.map((event) => event.payload)).toEqual([{ routeId: route.id }]);
    expect(await routesDb(h).sources.countDocuments({ _id: route.id })).toBe(1);

    expect(await processRoute(h, route.id)).toBe('ready');
    const ref = expectedFixtures['route-trk-no-time.gpx']!;
    const doc = await routeDoc(route.id);
    expect(doc).toMatchObject({ status: 'ready', failure: null, isLoop: false, attempts: 1 });
    expect(Math.abs(doc!.distanceM! - ref.distanceM)).toBeLessThan(1);
    expect(doc!.elevationGainM).toBeGreaterThan(30);
    expect(doc!.start).toEqual({ type: 'Point', coordinates: [27.56, 53.9] });
    expect(doc!.finish?.type).toBe('Point');
    const geometry = await routesDb(h).geometries.findOne({ _id: route.id });
    expect(geometry!.line.coordinates.length).toBeLessThanOrEqual(1000);
    expect(geometry!.line.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(geometry!.matchLine.length).toBeLessThanOrEqual(20_000);
    expect(geometry!.matchLine[0]).toEqual([27.56, 53.9]);
    expect(geometry!.sourcePointCount).toBe(ref.points);
    // routes-03: профиль высоты, версия производных и очищенный GPX — в той же транзакции
    expect(geometry!.derivedVersion).toBe(ROUTE_DERIVED_VERSION);
    expect(geometry!.profile![0]![0]).toBe(0);
    expect(geometry!.profile!.at(-1)![0]).toBe(doc!.distanceM);
    const exported = await routesDb(h).exports.findOne({ _id: route.id });
    expect(exported).toMatchObject({ derivedVersion: ROUTE_DERIVED_VERSION });
    const gpx = Buffer.from(exported!.gpx.buffer).toString('utf8');
    expect(exported!.sizeBytes).toBe(exported!.gpx.buffer.byteLength);
    expect(parseGpx(gpx).points).toHaveLength(geometry!.matchLine.length);

    const read = await panelCall(h, org.token, 'GET', `${ROUTES}/${route.id}`);
    expect(read.status).toBe(200);
    expect(parsedRoute(read)).toMatchObject({
      status: 'ready',
      distanceM: doc!.distanceM,
      line: geometry!.line.coordinates,
    });
    expect(read.body).not.toHaveProperty('matchLine');

    const again = await uploadRoute(h, org.token, fixture('route-trk-no-time.gpx'), {
      title: 'Другое название',
    });
    expect(again.status).toBe(200);
    expect(parsedRoute(again)).toMatchObject({ id: route.id, title: 'Минское кольцо' });
    expect(await routesDb(h).routes.countDocuments()).toBe(1);
  });

  it('rte планировщика и петля — ready (isLoop у петли)', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const rte = await readyRoute(h, org.token, 'route-rte.gpx', 'Планировщик');
    const loop = await readyRoute(h, org.token, 'route-loop.gpx', 'Круг');
    expect(await routeDoc(rte)).toMatchObject({ status: 'ready', isLoop: false });
    expect(await routeDoc(loop)).toMatchObject({ status: 'ready', isLoop: true });
  });

  it('повтор задачи после ready и после failed — no-op (отрицательное доказательство условия статуса)', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token);
    const before = await routeDoc(id);
    const geometry = await routesDb(h).geometries.findOne({ _id: id });
    const exported = await routesDb(h).exports.findOne({ _id: id });
    expect(await processRoute(h, id)).toBe('skipped');
    expect(await routeDoc(id)).toEqual(before);
    expect(await routesDb(h).geometries.findOne({ _id: id })).toEqual(geometry);
    expect(await routesDb(h).exports.find().toArray()).toEqual([exported]);

    const short = parsedRoute(await uploadRoute(h, org.token, fixture('route-short.gpx')));
    expect(await processRoute(h, short.id)).toBe('failed');
    const failed = await routeDoc(short.id);
    expect(await processRoute(h, short.id)).toBe('skipped');
    expect(await routeDoc(short.id)).toEqual(failed);
  });
});

describe('отказы (AC2, AC10)', () => {
  it('worker: < 1 км, без точек, > 1000 км, > 50 000 точек, ENTITY в теле — failed с кодом; панель видит причину', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const cases: [string, Buffer, string][] = [
      ['short', fixture('route-short.gpx'), 'too_short'],
      ['empty', Buffer.from('<gpx><trk><trkseg></trkseg></trk></gpx>'), 'no_track'],
      ['long', straightGpx(200, 0.1), 'too_long'],
      ['dense', straightGpx(50_001, 0.00001), 'too_many_points'],
      [
        'entity',
        Buffer.from(
          '<gpx><!ENTITY x "y"><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>',
        ),
        'unreadable',
      ],
    ];
    for (const [title, bytes, failure] of cases) {
      const res = await uploadRoute(h, org.token, bytes, { title: `Маршрут ${title}` });
      expect(res.status, title).toBe(202);
      const { id } = parsedRoute(res);
      expect(await processRoute(h, id), title).toBe('failed');
      const read = parsedRoute(await panelCall(h, org.token, 'GET', `${ROUTES}/${id}`));
      expect(read, title).toMatchObject({ status: 'failed', failure, line: [] });
    }
    expect(await routesDb(h).geometries.countDocuments()).toBe(0);
  });

  it('не GPX (PNG, FIT, DOCTYPE/XXE до корня) — 415; 0 байт — 400; > 5 МиБ — 413; JSON — 415; без названия — 400', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    for (const bytes of [
      png,
      fixture('garmin-edge-ride.fit'),
      fixture('xxe.gpx'),
      fixture('billion-laughs.gpx'),
    ]) {
      const res = await uploadRoute(h, org.token, bytes);
      expect(res.status).toBe(415);
      expect(res.body).toMatchObject({ code: 'ROUTE_FORMAT_UNSUPPORTED' });
    }
    expect((await uploadRoute(h, org.token, Buffer.alloc(0))).status).toBe(400);
    const large = await uploadRoute(h, org.token, Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));
    expect(large.status).toBe(413);
    expect(large.body).toMatchObject({ code: 'ROUTE_TOO_LARGE' });
    expect(large.headers['connection']).toBe('close');
    const json = await uploadRoute(h, org.token, Buffer.from('{"a":1}'), {
      contentType: 'application/json',
    });
    expect(json.status).toBe(415);

    const noTitle = await uploadRoute(h, org.token, fixture('route-rte.gpx'), { title: null });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [{ path: 'title', code: 'REQUIRED' }] },
    });
    const multiline = await uploadRoute(h, org.token, fixture('route-rte.gpx'), {
      title: 'a\nb\nc',
    });
    expect(multiline.status).toBe(400);
    expect(await routesDb(h).routes.countDocuments()).toBe(0);
    expect(await panel(h).audit.countDocuments({ action: 'route.created' })).toBe(0);
  });

  it('сбой потока — ретрай (processing); последняя попытка — failed: unreadable; таймаут — failed: timeout', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const processor = h.worker.get(RouteProcessingProcessor);
    const crashed = parsedRoute(await uploadRoute(h, org.token, fixture('route-rte.gpx')));
    const analyze = vi.spyOn(processor, 'analyze').mockRejectedValue(new Error('thread crashed'));
    await expect(processor.processRoute(crashed.id)).rejects.toThrow('thread crashed');
    expect(await routeDoc(crashed.id)).toMatchObject({ status: 'processing', failure: null });
    expect(await processor.processRoute(crashed.id, { finalAttempt: true })).toBe('failed');
    analyze.mockRestore();
    expect(await routeDoc(crashed.id)).toMatchObject({ status: 'failed', failure: 'unreadable' });

    const slow = parsedRoute(await uploadRoute(h, org.token, fixture('route-loop.gpx')));
    const limits = processor.parseLimits;
    processor.parseLimits = { ...limits, timeoutMs: 1 };
    try {
      expect(await processor.processRoute(slow.id)).toBe('failed');
    } finally {
      processor.parseLimits = limits;
    }
    expect(await routeDoc(slow.id)).toMatchObject({ status: 'failed', failure: 'timeout' });
  });

  it('лимит загрузок сотрудника — 429 с Retry-After, тело не читается', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const statuses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const bytes = Buffer.concat([fixture('route-rte.gpx'), Buffer.from(`<!-- ${i} -->`)]);
      statuses.push((await uploadRoute(h, org.token, bytes)).status);
    }
    expect(statuses.every((status) => status === 202)).toBe(true);
    const limited = await uploadRoute(h, org.token, fixture('route-loop.gpx'));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(await routesDb(h).routes.countDocuments()).toBe(20);
  });
});

describe('дедуп при гонке загрузок (AC16)', () => {
  it('вставка проиграла гонку (дубль ключа routes_owner_sha_unique) — 200 с маршрутом победителя, без второй записи', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const bytes = fixture('route-rte.gpx');
    const first = parsedRoute(await uploadRoute(h, org.token, bytes));
    // ранняя проверка «тот же файл» не видит победителя (он ещё не закоммичен) — вставка получает E11000
    const lookup = vi
      .spyOn(h.app.get(RoutesRepository, { strict: false }), 'findByOwnerSha')
      .mockResolvedValueOnce(undefined);
    const raced = await uploadRoute(h, org.token, bytes);
    expect(lookup).toHaveBeenCalled();
    expect(raced.status).toBe(200);
    expect(parsedRoute(raced).id).toBe(first.id);
    expect(await routesDb(h).routes.countDocuments()).toBe(1);
    expect(await routesDb(h).sources.countDocuments()).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'route.created' })).toBe(1);
    const events = (await outboxEvents(h)).filter((event) => event.type === ROUTE_RECEIVED);
    expect(events).toHaveLength(1);
  });
});

describe('повторная обработка (ревью pass 1)', () => {
  const routeEvents = async () =>
    (await outboxEvents(h)).filter((event) => event.type === ROUTE_RECEIVED);

  it('последняя попытка: сбой записи результата — failed: unreadable; не последняя — ретрай, processing', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const { id } = parsedRoute(await uploadRoute(h, org.token, fixture('route-rte.gpx')));
    const processor = h.worker.get(RouteProcessingProcessor);
    const write = vi
      .spyOn(h.worker.get(RoutesRepository), 'markReady')
      .mockRejectedValue(new Error('write conflict'));
    await expect(processor.processRoute(id)).rejects.toThrow('write conflict');
    expect(await routeDoc(id)).toMatchObject({ status: 'processing', failure: null });
    expect(await processor.processRoute(id, { finalAttempt: true })).toBe('failed');
    write.mockRestore();
    expect(await routeDoc(id)).toMatchObject({ status: 'failed', failure: 'unreadable' });
    expect(await routesDb(h).geometries.countDocuments()).toBe(0);
    expect(await routesDb(h).exports.countDocuments()).toBe(0);
  });

  it('тот же файл после failed — 202, тот же маршрут снова в обработке (новое событие), worker → ready', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const bytes = fixture('route-rte.gpx');
    const { id } = parsedRoute(await uploadRoute(h, org.token, bytes));
    const processor = h.worker.get(RouteProcessingProcessor);
    const analyze = vi.spyOn(processor, 'analyze').mockRejectedValue(new Error('thread crashed'));
    expect(await processor.processRoute(id, { finalAttempt: true })).toBe('failed');
    analyze.mockRestore();
    expect(await routeEvents()).toHaveLength(1);

    const again = await uploadRoute(h, org.token, bytes);
    expect(again.status).toBe(202);
    expect(parsedRoute(again)).toMatchObject({ id, status: 'processing', failure: null });
    expect(await routeEvents()).toHaveLength(2);
    expect(await routeDoc(id)).toMatchObject({ status: 'processing', attempts: 0 });
    expect(await processRoute(h, id)).toBe('ready');
    expect(await routesDb(h).routes.countDocuments()).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'route.created' })).toBe(1);
  });

  it('тот же файл, маршрут завис в processing дольше 15 мин — снова в обработку; раньше — 200 без события', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const bytes = fixture('route-rte.gpx');
    const { id } = parsedRoute(await uploadRoute(h, org.token, bytes));

    h.clock.advance(14 * MINUTE);
    const fresh = await uploadRoute(h, org.token, bytes);
    expect(fresh.status).toBe(200);
    expect(await routeEvents()).toHaveLength(1);

    h.clock.advance(2 * MINUTE);
    const stuck = await uploadRoute(h, org.token, bytes);
    expect(stuck.status).toBe(202);
    expect(parsedRoute(stuck).id).toBe(id);
    expect(await routeEvents()).toHaveLength(2);

    // готовый маршрут повтором не трогается
    expect(await processRoute(h, id)).toBe('ready');
    h.clock.advance(60 * MINUTE);
    const ready = await uploadRoute(h, org.token, bytes);
    expect(ready.status).toBe(200);
    expect(parsedRoute(ready).status).toBe('ready');
    expect(await routeEvents()).toHaveLength(2);
  });
});

describe('видимость и список (Q2)', () => {
  it('готовые — всем; необработанные — только автору (чужой — 404); status=ready; курсор без дублей', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    const org = await staff(h, 'org@example.by', 'organizer');
    const ready = await readyRoute(h, admin.token, 'route-loop.gpx', 'Круг админа');
    const pending = parsedRoute(await uploadRoute(h, admin.token, fixture('route-rte.gpx'))).id;
    const own = parsedRoute(await uploadRoute(h, org.token, fixture('route-short.gpx'))).id;

    expect((await panelCall(h, org.token, 'GET', `${ROUTES}/${ready}`)).status).toBe(200);
    expect((await panelCall(h, org.token, 'GET', `${ROUTES}/${pending}`)).status).toBe(404);
    const unknown = '01890a5d-ac96-774b-bcce-b302099a8057';
    expect((await panelCall(h, org.token, 'GET', `${ROUTES}/${unknown}`)).status).toBe(404);
    expect((await panelCall(h, org.token, 'GET', `${ROUTES}/not-a-uuid`)).status).toBe(400);

    const ids = async (query: string) =>
      PanelRoutePage.parse(
        (await panelCall(h, org.token, 'GET', `${ROUTES}${query}`)).body,
      ).items.map((item) => item.id);
    expect(await ids('')).toEqual([own, ready]);
    expect(await ids('?status=ready')).toEqual([ready]);
    expect((await panelCall(h, org.token, 'GET', `${ROUTES}?status=failed`)).status).toBe(400);
    expect((await panelCall(h, org.token, 'GET', `${ROUTES}?cursor[$ne]=x`)).status).toBe(400);

    const first = PanelRoutePage.parse(
      (await panelCall(h, org.token, 'GET', `${ROUTES}?limit=1`)).body,
    );
    expect(first.items.map((item) => item.id)).toEqual([own]);
    const second = PanelRoutePage.parse(
      (await panelCall(h, org.token, 'GET', `${ROUTES}?limit=1&cursor=${first.nextCursor}`)).body,
    );
    expect(second.items.map((item) => item.id)).toEqual([ready]);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]).not.toHaveProperty('line');
  });
});
