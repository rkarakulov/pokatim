import { PanelRace } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { panelCall } from '../../../test/panel';
import {
  createRace,
  createSeason,
  fieldCodes,
  publishedRace,
  RACES,
  racesDb,
  staff,
} from '../../../test/races';
import { readyRoute, routesDb } from '../../../test/routes';

/**
 * V-12 и ворота коридора в панели (race-results-03, AC2, AC5): `lockedAt` гонки (пишет первая заявка, здесь — в БД
 * как подготовка) фиксирует коридор, окно, класс и покрытия; линейный маршрут с близкими концами — ошибка поля.
 * Стенд: «сейчас» — 22.10.2026 12:00 Минска, окно по умолчанию 24.10 — 26.10.
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

/** Готовый линейный маршрут с концами в `endsM` м друг от друга — напрямую в БД (подготовка). */
async function linearRoute(ownerUserId: string, endsM: number): Promise<string> {
  const id = uuidv7();
  const start: [number, number] = [27.559, 53.9006];
  const finish: [number, number] = [27.559 + endsM / 65_600, 53.9006];
  const now = h.clock.now();
  await routesDb(h).routes.insertOne({
    _id: id,
    origin: 'platform',
    ownerUserId,
    title: 'Туда и почти обратно',
    status: 'ready',
    failure: null,
    attempts: 1,
    sha256: id,
    sizeBytes: 1,
    distanceM: 5000,
    elevationGainM: null,
    isLoop: false,
    start: { type: 'Point', coordinates: start },
    finish: { type: 'Point', coordinates: finish },
    catalog: null,
    createdAt: now,
    updatedAt: now,
  });
  await routesDb(h).geometries.insertOne({
    _id: id,
    line: { type: 'LineString', coordinates: [start, [27.6, 53.92], finish] },
    matchLine: [start, [27.6, 53.92], finish],
    sourcePointCount: 3,
  });
  return id;
}

describe('V-12: заявки фиксируют коридор, окно, класс и покрытия (AC2)', () => {
  it('lockedAt: editable без зафиксированных полей, причина entries_locked; их правка — FIELD_LOCKED, название — можно', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await createSeason(h, admin.token);
    const routeId = await readyRoute(h, admin.token);
    const race = await publishedRace(h, admin.token, {
      distanceKm: undefined,
      corridor: { routeId, widthM: 50 },
    });
    const before = PanelRace.parse(
      (await panelCall(h, admin.token, 'GET', `${RACES}/${race.id}`)).body,
    );
    expect(before.editable.reasons).toEqual([]);
    expect(before.editable.fields).toContain('windowEndsAt');

    await racesDb(h).races.updateOne({ _id: race.id }, { $set: { lockedAt: h.clock.now() } });
    const locked = PanelRace.parse(
      (await panelCall(h, admin.token, 'GET', `${RACES}/${race.id}`)).body,
    );
    expect(locked.editable.reasons).toEqual(['entries_locked']);
    expect(locked.editable.fields).toEqual(['title', 'description', 'protocolPlannedAt']);

    const edit = (body: Record<string, unknown>) =>
      panelCall(h, admin.token, 'POST', `${RACES}/${race.id}`, {
        version: locked.version,
        ...body,
      });
    const extended = await edit({ windowEndsAt: '2026-10-27T20:59:00.000Z' });
    expect(extended.status).toBe(400);
    expect(fieldCodes(extended.body)).toContain('windowEndsAt:FIELD_LOCKED');
    const reclassed = await edit({ bikeClass: 'gravel', surfaces: ['gravel'] });
    expect(fieldCodes(reclassed.body)).toEqual(['bikeClass:FIELD_LOCKED', 'surfaces:FIELD_LOCKED']);
    const widened = await edit({ corridor: { routeId, widthM: 100 } });
    expect(fieldCodes(widened.body)).toEqual(['corridor:FIELD_LOCKED']);
    const renamed = await edit({ title: 'Минское кольцо — финал' });
    expect(renamed.status).toBe(200);
    expect(PanelRace.parse(renamed.body).title).toBe('Минское кольцо — финал');
  });
});

describe('ворота коридора (AC5)', () => {
  it('линейный маршрут с концами ≤ 2·max(widthM, 30) — CORRIDOR_GATES_OVERLAP; дальше или петля — можно', async () => {
    const admin = await staff(h, 'admin@example.by', 'admin');
    await createSeason(h, admin.token);
    const near = await linearRoute(admin.userId, 90);
    const create = (routeId: string, widthM: number) =>
      panelCall(h, admin.token, 'POST', RACES, {
        title: 'Туда-обратно',
        bikeClass: 'road',
        surfaces: ['asphalt'],
        description: null,
        windowStartsAt: '2026-10-23T21:00:00.000Z',
        windowEndsAt: '2026-10-26T20:59:00.000Z',
        protocolPlannedAt: '2026-10-28T20:59:00.000Z',
        corridor: { routeId, widthM },
      });
    const overlap = await create(near, 50);
    expect(overlap.status).toBe(400);
    expect(fieldCodes(overlap.body)).toEqual(['corridor.routeId:CORRIDOR_GATES_OVERLAP']);
    // допуск 40 → ворота 40 м: 90 > 80 — можно
    expect((await create(near, 40)).status).toBe(201);
    const loop = await readyRoute(h, admin.token, 'route-loop.gpx', 'Петля');
    expect((await create(loop, 200)).status).toBe(201);

    // смена допуска у того же маршрута тоже проверяет ворота
    const draft = await createRace(h, admin.token, {
      distanceKm: undefined,
      corridor: { routeId: near, widthM: 40 },
    });
    const widened = await panelCall(h, admin.token, 'POST', `${RACES}/${draft.id}`, {
      version: draft.version,
      corridor: { routeId: near, widthM: 50 },
    });
    expect(fieldCodes(widened.body)).toEqual(['corridor.routeId:CORRIDOR_GATES_OVERLAP']);
  });
});
