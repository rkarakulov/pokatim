import { PanelRace, RaceDetail, RaceRouteMap } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panel, panelCall, panelSession } from '../../../test/panel';
import {
  createRace,
  createSeason,
  fieldCodes,
  publishedRace,
  raceBody,
  RACES,
  racesDb,
  staff,
} from '../../../test/races';
import {
  fixture,
  parsedRoute,
  processRoute,
  readyRoute,
  routesRepository,
  uploadRoute,
} from '../../../test/routes';

/**
 * Коридор гонки (race-results-01: AC3–AC9, AC15): готовый маршрут + допуск, дистанция из маршрута, правила по фазам,
 * `ROUTE_NOT_READY`, журнал, публичная карточка. Стенд: «сейчас» — 22.10.2026 12:00 Минска; окно по умолчанию —
 * 24.10 00:00 — 26.10 23:59; маршрут `route-trk-no-time.gpx` ≈ 10,6 км, `route-rte.gpx` ≈ 20,8 км.
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

const parse = (body: unknown) => PanelRace.parse(body);
const withoutDistance = { distanceKm: undefined };

/** Админ с сезоном 2026, организатор и готовый маршрут админа. */
async function setup() {
  const admin = await staff(h, 'admin@example.by', 'admin');
  await createSeason(h, admin.token);
  const org = await staff(h, 'org@example.by', 'organizer');
  const routeId = await readyRoute(h, admin.token, 'route-trk-no-time.gpx', 'Минское кольцо');
  const route = await h.db.collection<{ _id: string; distanceM: number }>('routes').findOne({
    _id: routeId,
  });
  const distanceKm = Math.round(route!.distanceM / 100) / 10;
  return { admin, org, routeId, distanceM: route!.distanceM, distanceKm };
}

async function travel(ms: number, email: string): Promise<string> {
  h.clock.advance(ms);
  return panelSession(h, email);
}

describe('черновик и предстоящая (AC3, AC6, AC9)', () => {
  it('коридор без distanceKm — 201: маршрут с названием, допуск, длина; дистанция вычислена и только чтение', async () => {
    const { org, routeId, distanceM, distanceKm } = await setup();
    const res = await panelCall(
      h,
      org.token,
      'POST',
      RACES,
      raceBody({ ...withoutDistance, corridor: { routeId, widthM: 50 } }),
    );
    expect(res.status).toBe(201);
    const race = parse(res.body);
    expect(race.corridor).toEqual({
      route: { id: routeId, title: 'Минское кольцо' },
      widthM: 50,
      distanceM,
    });
    expect(race.distanceKm).toBe(distanceKm);
    expect(race.editable.fields).not.toContain('distanceKm');
    expect(race.editable.fields).toContain('corridor');
    expect(await racesDb(h).races.findOne({ _id: race.id })).toMatchObject({
      corridor: { routeId, widthM: 50, distanceM },
      distanceKm,
    });

    const list = await panelCall(h, org.token, 'GET', RACES);
    expect((list.body as { items: PanelRace[] }).items[0]?.corridor?.route.title).toBe(
      'Минское кольцо',
    );
  });

  it('без коридора и без distanceKm — REQUIRED; distanceKm ≠ длине маршрута — FIELD_LOCKED; равна — 201', async () => {
    const { org, routeId, distanceKm } = await setup();
    const missing = await panelCall(h, org.token, 'POST', RACES, raceBody(withoutDistance));
    expect(fieldCodes(missing.body)).toEqual(['distanceKm:REQUIRED']);
    const nullCorridor = await panelCall(
      h,
      org.token,
      'POST',
      RACES,
      raceBody({ ...withoutDistance, corridor: null }),
    );
    expect(fieldCodes(nullCorridor.body)).toEqual(['distanceKm:REQUIRED']);

    const corridor = { routeId, widthM: 50 };
    const mismatch = await panelCall(
      h,
      org.token,
      'POST',
      RACES,
      raceBody({ distanceKm: distanceKm + 1, corridor }),
    );
    expect(mismatch.status).toBe(400);
    expect(fieldCodes(mismatch.body)).toEqual(['distanceKm:FIELD_LOCKED']);
    const same = await panelCall(h, org.token, 'POST', RACES, raceBody({ distanceKm, corridor }));
    expect(same.status).toBe(201);
    expect(await racesDb(h).races.countDocuments()).toBe(1);
  });

  it('задать, сменить допуск, снять: журнал race.updated с полями; после снятия дистанция прежняя и редактируемая', async () => {
    const { org, routeId, distanceKm } = await setup();
    let race = await createRace(h, org.token);
    const edit = (body: Record<string, unknown>) =>
      panelCall(h, org.token, 'POST', `${RACES}/${race.id}`, { version: race.version, ...body });

    const set = await edit({ corridor: { routeId, widthM: 50 } });
    expect(set.status).toBe(200);
    race = parse(set.body);
    expect(parse(set.body)).toMatchObject({ distanceKm, corridor: { widthM: 50 } });

    const width = await edit({ corridor: { routeId, widthM: 100 } });
    expect(width.status).toBe(200);
    race = parse(width.body);

    const removed = await edit({ corridor: null });
    expect(removed.status).toBe(200);
    const after = parse(removed.body);
    expect(after.corridor).toBeNull();
    expect(after.distanceKm).toBe(distanceKm);
    expect(after.editable.fields).toContain('distanceKm');

    const updates = await panel(h)
      .audit.find({ action: 'race.updated', 'subject.id': race.id })
      .sort({ _id: 1 })
      .toArray();
    expect(updates.map((entry) => entry.details?.changedFields)).toEqual([
      ['distanceKm', 'corridor'],
      ['corridor'],
      ['corridor'],
    ]);
  });

  it('предстоящая опубликованная — коридор задаётся и меняется на другой маршрут (дистанция пересчитана)', async () => {
    const { admin, org, routeId } = await setup();
    const other = await readyRoute(h, admin.token, 'route-rte.gpx', 'Планировщик');
    let race = await publishedRace(h, org.token, {
      ...withoutDistance,
      corridor: { routeId, widthM: 50 },
    });
    const edit = (body: Record<string, unknown>) =>
      panelCall(h, org.token, 'POST', `${RACES}/${race.id}`, { version: race.version, ...body });
    expect(parse((await panelCall(h, org.token, 'GET', `${RACES}/${race.id}`)).body).phase).toBe(
      'upcoming',
    );
    const changed = await edit({ corridor: { routeId: other, widthM: 25 } });
    expect(changed.status).toBe(200);
    race = parse(changed.body);
    const doc = await h.db
      .collection<{ _id: string; distanceM: number }>('routes')
      .findOne({ _id: other });
    expect(parse(changed.body)).toMatchObject({
      corridor: {
        route: { id: other, title: 'Планировщик' },
        widthM: 25,
        distanceM: doc!.distanceM,
      },
      distanceKm: Math.round(doc!.distanceM / 100) / 10,
    });
  });
});

describe('фазы (AC4, AC7)', () => {
  it('открытое окно: без коридора — задать; с коридором — FIELD_LOCKED; закрытое — FIELD_LOCKED; отменённая — 409', async () => {
    const { org, routeId } = await setup();
    const announce = await publishedRace(h, org.token);
    let withCorridor = await publishedRace(h, org.token, {
      ...withoutDistance,
      corridor: { routeId, widthM: 50 },
    });
    const cancelled = await publishedRace(h, org.token);

    // 24.10 12:00 — окно открыто
    let token = await travel(2 * DAY, 'org@example.by');
    const openAnnounce = parse((await panelCall(h, token, 'GET', `${RACES}/${announce.id}`)).body);
    expect(openAnnounce.phase).toBe('open');
    expect(openAnnounce.editable.fields).toContain('corridor');
    const set = await panelCall(h, token, 'POST', `${RACES}/${announce.id}`, {
      version: announce.version,
      corridor: { routeId, widthM: 50 },
    });
    expect(set.status).toBe(200);
    expect(parse(set.body).editable.fields).not.toContain('corridor');

    const openWith = parse((await panelCall(h, token, 'GET', `${RACES}/${withCorridor.id}`)).body);
    expect(openWith.editable.fields).not.toContain('corridor');
    expect(openWith.editable.fields).not.toContain('distanceKm');
    for (const corridor of [{ routeId, widthM: 100 }, null]) {
      const locked = await panelCall(h, token, 'POST', `${RACES}/${withCorridor.id}`, {
        version: openWith.version,
        corridor,
      });
      expect(fieldCodes(locked.body)).toEqual(['corridor:FIELD_LOCKED']);
    }
    withCorridor = openWith;

    const cancel = await panelCall(h, token, 'POST', `${RACES}/${cancelled.id}/cancel`, {
      version: cancelled.version,
      reason: 'weather',
    });
    expect(cancel.status).toBe(200);
    const onCancelled = await panelCall(h, token, 'POST', `${RACES}/${cancelled.id}`, {
      version: parse(cancel.body).version,
      corridor: { routeId, widthM: 50 },
    });
    expect(onCancelled.status).toBe(409);
    expect(onCancelled.body).toMatchObject({ code: 'RACE_INVALID_STATE' });

    // 28.10 12:00 — окно закрыто
    token = await travel(4 * DAY, 'org@example.by');
    const closed = await panelCall(h, token, 'POST', `${RACES}/${withCorridor.id}`, {
      version: withCorridor.version,
      corridor: { routeId, widthM: 100 },
    });
    expect(fieldCodes(closed.body)).toEqual(['corridor:FIELD_LOCKED']);
  });

  it('публикация без коридора — как раньше (анонс)', async () => {
    const { org } = await setup();
    const race = await publishedRace(h, org.token);
    const read = parse((await panelCall(h, org.token, 'GET', `${RACES}/${race.id}`)).body);
    expect(read).toMatchObject({ status: 'published', corridor: null });
  });
});

describe('ROUTE_NOT_READY и права (AC5, AC14)', () => {
  it('все ошибки сразу: REQUIRED дистанции и ROUTE_NOT_READY — вместе с правилами окна; зафиксированный коридор — FIELD_LOCKED, не ROUTE_NOT_READY', async () => {
    const { org, routeId } = await setup();
    const tooEarly = { protocol: '2026-10-27T00:00' };
    const missing = await panelCall(
      h,
      org.token,
      'POST',
      RACES,
      raceBody(withoutDistance, tooEarly),
    );
    expect(fieldCodes(missing.body)).toEqual([
      'distanceKm:REQUIRED',
      'protocolPlannedAt:PROTOCOL_TOO_EARLY',
    ]);
    const unknown = '01890a5d-ac96-774b-bcce-b302099a8057';
    const notReady = await panelCall(
      h,
      org.token,
      'POST',
      RACES,
      raceBody({ ...withoutDistance, corridor: { routeId: unknown, widthM: 50 } }, tooEarly),
    );
    expect(fieldCodes(notReady.body)).toEqual([
      'corridor.routeId:ROUTE_NOT_READY',
      'protocolPlannedAt:PROTOCOL_TOO_EARLY',
    ]);

    // открытое окно, коридор есть: смена на несуществующий маршрут — поле зафиксировано (маршрут не проверяется)
    const race = await publishedRace(h, org.token, {
      ...withoutDistance,
      corridor: { routeId, widthM: 50 },
    });
    const token = await travel(2 * DAY, 'org@example.by');
    const locked = await panelCall(h, token, 'POST', `${RACES}/${race.id}`, {
      version: race.version,
      corridor: { routeId: unknown, widthM: 50 },
    });
    expect(fieldCodes(locked.body)).toEqual(['corridor:FIELD_LOCKED']);
  });

  it('маршрут processing, failed, несуществующий, чужой необработанный — 400 corridor.routeId ROUTE_NOT_READY', async () => {
    const { admin, org } = await setup();
    const own = parsedRoute(await uploadRoute(h, org.token, fixture('route-rte.gpx'))).id;
    const failed = parsedRoute(await uploadRoute(h, org.token, fixture('route-short.gpx'))).id;
    expect(await processRoute(h, failed)).toBe('failed');
    const foreign = parsedRoute(await uploadRoute(h, admin.token, fixture('route-loop.gpx'))).id;
    const unknown = '01890a5d-ac96-774b-bcce-b302099a8057';
    const race = await createRace(h, org.token);

    for (const routeId of [own, failed, foreign, unknown]) {
      const created = await panelCall(
        h,
        org.token,
        'POST',
        RACES,
        raceBody({ ...withoutDistance, corridor: { routeId, widthM: 50 } }),
      );
      expect(created.status, routeId).toBe(400);
      expect(fieldCodes(created.body), routeId).toEqual(['corridor.routeId:ROUTE_NOT_READY']);
      const updated = await panelCall(h, org.token, 'POST', `${RACES}/${race.id}`, {
        version: race.version,
        corridor: { routeId, widthM: 50 },
      });
      expect(fieldCodes(updated.body), routeId).toEqual(['corridor.routeId:ROUTE_NOT_READY']);
    }
    expect(await racesDb(h).races.countDocuments()).toBe(1);
    expect(await panel(h).audit.countDocuments({ action: 'race.updated' })).toBe(0);
  });

  it('организатор прикрепляет чужой готовый маршрут; чужая гонка — 404', async () => {
    const { admin, org, routeId } = await setup();
    const own = await createRace(h, org.token, {
      ...withoutDistance,
      corridor: { routeId, widthM: 50 },
    });
    expect(own.id).toBeDefined();
    const adminRace = await createRace(h, admin.token);
    const foreign = await panelCall(h, org.token, 'POST', `${RACES}/${adminRace.id}`, {
      version: adminRace.version,
      corridor: { routeId, widthM: 50 },
    });
    expect(foreign.status).toBe(404);
  });

  it('инъекция и границы: оператор в routeId, лишние ключи, widthM 15/52/205 — 400 без записи', async () => {
    const { org, routeId } = await setup();
    for (const corridor of [
      { routeId: { $ne: null }, widthM: 50 },
      { routeId, widthM: 50, distanceM: 1 },
      { routeId, widthM: 15 },
      { routeId, widthM: 52 },
      { routeId, widthM: 205 },
      routeId,
    ]) {
      const res = await panelCall(
        h,
        org.token,
        'POST',
        RACES,
        raceBody({ ...withoutDistance, corridor }),
      );
      expect(res.status, JSON.stringify(corridor)).toBe(400);
    }
    expect(await racesDb(h).races.countDocuments()).toBe(0);
  });
});

describe('публичная карточка (AC8)', () => {
  it('GET /v1/races/:id — corridor { widthM } без routeId и координат; без коридора — null', async () => {
    const { org, routeId } = await setup();
    const withCorridor = await publishedRace(h, org.token, {
      ...withoutDistance,
      corridor: { routeId, widthM: 50 },
    });
    const announce = await publishedRace(h, org.token);

    const detail = await call(h, 'GET', `/v1/races/${withCorridor.id}`);
    expect(detail.status).toBe(200);
    expect(RaceDetail.parse(detail.body).corridor).toEqual({ widthM: 50 });
    expect(JSON.stringify(detail.body)).not.toContain(routeId);
    expect(JSON.stringify(detail.body)).not.toContain('coordinates');

    const plain = await call(h, 'GET', `/v1/races/${announce.id}`);
    expect((plain.body as { corridor: unknown }).corridor).toBeNull();
  });
});

describe('карта маршрута (maps-01)', () => {
  const routeUrl = (id: string) => `/v1/races/${id}/route`;

  it('опубликованная с коридором — 200: ровно line/start/finish/bounds/widthM из маршрута, public max-age=60', async () => {
    const { org, routeId } = await setup();
    const race = await publishedRace(h, org.token, {
      ...withoutDistance,
      corridor: { routeId, widthM: 50 },
    });
    const res = await call(h, 'GET', routeUrl(race.id));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const body = RaceRouteMap.parse(res.body);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'bounds',
      'finish',
      'line',
      'start',
      'widthM',
    ]);
    const route = await h.db
      .collection<{
        _id: string;
        title: string;
        sha256: string;
        start: { coordinates: [number, number] };
        finish: { coordinates: [number, number] };
      }>('routes')
      .findOne({ _id: routeId });
    const geometry = await h.db
      .collection<{ _id: string; line: { coordinates: [number, number][] } }>('route_geometries')
      .findOne({ _id: routeId });
    expect(body.line).toEqual(geometry!.line.coordinates);
    expect(body.start).toEqual(route!.start.coordinates);
    expect(body.finish).toEqual(route!.finish.coordinates);
    expect(body.widthM).toBe(50);
    const [west, south, east, north] = body.bounds;
    for (const [lon, lat] of body.line) {
      expect(lon).toBeGreaterThanOrEqual(west);
      expect(lon).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
    const text = JSON.stringify(res.body);
    for (const secret of [routeId, route!.sha256, route!.title, 'matchLine', 'routeId', 'status']) {
      expect(text).not.toContain(secret);
    }
  });

  it('отменённая с коридором — 200; черновик, неизвестный id, без коридора, коридор снят — 404 NOT_FOUND; не uuid — 400', async () => {
    const { org, routeId } = await setup();
    const corridor = { routeId, widthM: 50 };
    const cancelled = await publishedRace(h, org.token, { ...withoutDistance, corridor });
    const cancel = await panelCall(h, org.token, 'POST', `${RACES}/${cancelled.id}/cancel`, {
      version: cancelled.version,
      reason: 'weather',
    });
    expect(cancel.status).toBe(200);
    expect((await call(h, 'GET', routeUrl(cancelled.id))).status).toBe(200);

    const draft = await createRace(h, org.token, { ...withoutDistance, corridor });
    const plain = await publishedRace(h, org.token);
    const removed = await publishedRace(h, org.token, { ...withoutDistance, corridor });
    const edit = await panelCall(h, org.token, 'POST', `${RACES}/${removed.id}`, {
      version: removed.version,
      corridor: null,
    });
    expect(edit.status).toBe(200);
    for (const id of [draft.id, plain.id, removed.id, '01890a5d-ac96-774b-bcce-b302099a8057']) {
      const res = await call(h, 'GET', routeUrl(id));
      expect(res.status, id).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await call(h, 'GET', routeUrl('not-a-uuid'))).status).toBe(400);
  });

  it('кэш процесса: повторный запрос не читает route_geometries, линия сверки не грузится', async () => {
    const { org, routeId } = await setup();
    const race = await publishedRace(h, org.token, {
      ...withoutDistance,
      corridor: { routeId, widthM: 50 },
    });
    const repository = routesRepository(h);
    const display = vi.spyOn(repository, 'displayLine');
    const match = vi.spyOn(repository, 'geometry');
    try {
      const first = await call(h, 'GET', routeUrl(race.id));
      const second = await call(h, 'GET', routeUrl(race.id));
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(second.body).toEqual(first.body);
      expect(display).toHaveBeenCalledTimes(1);
      expect(match).not.toHaveBeenCalled();
    } finally {
      display.mockRestore();
      match.mockRestore();
    }
  });
});
