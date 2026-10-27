import { parseGpx, ROUTE_DERIVED_VERSION } from '@pokatim/tracks/parse';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';
import { Binary } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { staff } from '../../../test/races';
import { fixture, readyRoute, routesDb } from '../../../test/routes';
import { RouteDerivedBackfill } from './route-derived';
import { ROUTES_DERIVE_JOB, RoutesMaintenanceProcessor } from './routes-maintenance.processor';
import { RoutesRepository } from './routes.repository';

/**
 * Бэкфилл производных данных маршрута (routes-03, AC3): регламент `routes-maintenance` — `RouteDerivedBackfill.run`
 * напрямую (поток разбора настоящий, кроме пачки и отказов — подмена `derive`); маршрут «до слайса» — без
 * `profile`/`derivedVersion` и экспорта.
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

const backfill = () => h.worker.get(RouteDerivedBackfill);

/** Готовый маршрут до routes-03: геометрия без производных данных, экспорта нет. */
async function oldRoute(token: string, name = 'route-trk-no-time.gpx'): Promise<string> {
  const id = await readyRoute(h, token, name, `Маршрут ${name}`);
  await routesDb(h).geometries.updateOne(
    { _id: id },
    { $unset: { profile: '', derivedVersion: '' } },
  );
  await routesDb(h).exports.deleteOne({ _id: id });
  return id;
}

/** Быстрые «старые» маршруты прямой вставкой: геометрия и исходник (без документа `routes` — бэкфиллу не нужен). */
async function seedOld(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => uuidv7());
  const line: [number, number][] = [
    [27.5, 53.9],
    [27.6, 53.95],
  ];
  await routesDb(h).geometries.insertMany(
    ids.map((_id) => ({
      _id,
      line: { type: 'LineString' as const, coordinates: line },
      matchLine: line,
      sourcePointCount: 2,
    })),
  );
  await routesDb(h).sources.insertMany(
    ids.map((_id) => ({ _id, bytes: new Binary(fixture('route-loop.gpx')) })),
  );
  return ids;
}

const stubDerive = () =>
  vi.spyOn(backfill(), 'derive').mockResolvedValue({
    ok: true,
    result: {
      profile: [
        [0, 200],
        [1000, 210],
      ],
      gpx: '<gpx/>',
    },
  });

describe('RouteDerivedBackfill.run (routes-03)', () => {
  it('старый маршрут → профиль, версия и экспорт; второй прогон — 0; совпадает с разбором нового', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const fresh = await readyRoute(h, org.token, 'route-loop.gpx', 'Свежий');
    const freshGeometry = await routesDb(h).geometries.findOne({ _id: fresh });
    const freshExport = await routesDb(h).exports.findOne({ _id: fresh });
    // тот же исходник: «старый» маршрут — копия свежего без производных
    await routesDb(h).geometries.updateOne(
      { _id: fresh },
      { $unset: { profile: '', derivedVersion: '' } },
    );
    await routesDb(h).exports.deleteOne({ _id: fresh });
    const old = await oldRoute(org.token);

    expect(await backfill().run()).toEqual({ derived: 2, failed: 0, skipped: 0, more: false });
    const geometry = await routesDb(h).geometries.findOne({ _id: fresh });
    expect(geometry).toEqual(freshGeometry);
    expect(await routesDb(h).exports.findOne({ _id: fresh })).toEqual(freshExport);
    const oldGeometry = await routesDb(h).geometries.findOne({ _id: old });
    expect(oldGeometry?.derivedVersion).toBe(ROUTE_DERIVED_VERSION);
    expect(oldGeometry?.profile?.[0]?.[0]).toBe(0);
    const exported = await routesDb(h).exports.findOne({ _id: old });
    expect(exported?.derivedVersion).toBe(ROUTE_DERIVED_VERSION);
    expect(
      parseGpx(Buffer.from(exported!.gpx.buffer).toString('utf8')).points.length,
    ).toBeGreaterThan(1);

    expect(await backfill().run()).toEqual({ derived: 0, failed: 0, skipped: 0, more: false });
  });

  it('пачка 20 из 25 → more: true; остаток — следующим прогоном', async () => {
    await seedOld(25);
    const derive = stubDerive();
    expect(await backfill().run()).toEqual({ derived: 20, failed: 0, skipped: 0, more: true });
    expect(await backfill().run()).toEqual({ derived: 5, failed: 0, skipped: 0, more: false });
    expect(derive).toHaveBeenCalledTimes(25);
    expect(await routesDb(h).exports.countDocuments()).toBe(25);
    expect(
      await routesDb(h).geometries.countDocuments({ derivedVersion: ROUTE_DERIVED_VERSION }),
    ).toBe(25);
  });

  it('детерминированный отказ — derivedFailure, следующий прогон не берёт; рост версии — берёт и снимает метку', async () => {
    const [id] = await seedOld(1);
    vi.spyOn(backfill(), 'derive').mockResolvedValue({ ok: false, code: 'timeout' });
    expect(await backfill().run()).toEqual({ derived: 0, failed: 1, skipped: 0, more: false });
    expect((await routesDb(h).geometries.findOne({ _id: id }))?.derivedFailure).toMatchObject({
      version: ROUTE_DERIVED_VERSION,
      code: 'timeout',
    });
    expect(await routesDb(h).exports.countDocuments()).toBe(0);
    expect(await backfill().run()).toEqual({ derived: 0, failed: 0, skipped: 0, more: false });

    vi.restoreAllMocks();
    stubDerive();
    backfill().version = ROUTE_DERIVED_VERSION + 1;
    try {
      expect(await backfill().run()).toEqual({ derived: 1, failed: 0, skipped: 0, more: false });
    } finally {
      backfill().version = ROUTE_DERIVED_VERSION;
    }
    const geometry = await routesDb(h).geometries.findOne({ _id: id });
    expect(geometry?.derivedVersion).toBe(ROUTE_DERIVED_VERSION + 1);
    expect(geometry).not.toHaveProperty('derivedFailure');
    expect((await routesDb(h).exports.findOne({ _id: id }))?.derivedVersion).toBe(
      ROUTE_DERIVED_VERSION + 1,
    );
  });

  it('рост версии: посчитанные старой версией берутся снова (экспорт перезаписан)', async () => {
    const org = await staff(h, 'org@example.by', 'organizer');
    const id = await readyRoute(h, org.token, 'route-loop.gpx', 'Круг');
    expect(await backfill().run()).toMatchObject({ derived: 0 });
    stubDerive();
    backfill().version = ROUTE_DERIVED_VERSION + 1;
    try {
      expect(await backfill().run()).toMatchObject({ derived: 1 });
    } finally {
      backfill().version = ROUTE_DERIVED_VERSION;
    }
    const exported = await routesDb(h).exports.findOne({ _id: id });
    expect(Buffer.from(exported!.gpx.buffer).toString('utf8')).toBe('<gpx/>');
    expect(await routesDb(h).exports.countDocuments()).toBe(1);
  });

  it('сбой окружения (нет исходника, исключение потока) — без метки, остальные обработаны, повтор в следующий прогон', async () => {
    const [noSource, crashed, ok] = await seedOld(3);
    await routesDb(h).sources.deleteOne({ _id: noSource });
    const real = stubDerive().getMockImplementation()!;
    let calls = 0;
    vi.spyOn(backfill(), 'derive').mockImplementation((bytes) => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('thread crashed')) : real(bytes);
    });
    // порядок выборки не задан: крах — у первого маршрута с исходником
    const run = await backfill().run();
    expect(run).toEqual({ derived: 1, failed: 0, skipped: 2, more: false });
    for (const id of [noSource, crashed, ok]) {
      expect(await routesDb(h).geometries.findOne({ _id: id })).not.toHaveProperty(
        'derivedFailure',
      );
    }
    expect(await routesDb(h).exports.countDocuments()).toBe(1);
    // следующий прогон снова берёт оба пропущенных
    expect(await backfill().run()).toEqual({ derived: 1, failed: 0, skipped: 1, more: false });
  });

  it('повтор после записи (гонка двух прогонов) — recordDerived false, экспорт не дублируется', async () => {
    const [id] = await seedOld(1);
    stubDerive();
    expect(await backfill().run()).toMatchObject({ derived: 1 });
    const repository = h.worker.get(RoutesRepository);
    const pending = vi.spyOn(repository, 'pendingDerived').mockResolvedValue([id!]);
    expect(await backfill().run()).toEqual({ derived: 0, failed: 0, skipped: 1, more: false });
    pending.mockRestore();
    expect(await routesDb(h).exports.countDocuments()).toBe(1);
  });

  it('выборка — IXSCAN route_geometries_derived_idx (без COLLSCAN)', async () => {
    await seedOld(3);
    await h.db.command({ profile: 2 });
    try {
      await h.worker.get(RoutesRepository).pendingDerived(ROUTE_DERIVED_VERSION, 20);
    } finally {
      await h.db.command({ profile: 0 });
    }
    const entries = await h.db
      .collection<{ planSummary?: string }>('system.profile')
      .find({ ns: `${h.db.databaseName}.route_geometries`, op: 'query' })
      .toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.planSummary).toContain('IXSCAN { derivedVersion: 1 }');
    expect(entries[0]!.planSummary).not.toContain('COLLSCAN');
  });
});

describe('RoutesMaintenanceProcessor (routes-03, RC-13)', () => {
  it('derive — прогон; полная пачка ставит продолжение routes.derive.more; неизвестное имя — ошибка', async () => {
    const processor = h.worker.get(RoutesMaintenanceProcessor);
    const queue = (processor as unknown as { queue: { add: (...args: unknown[]) => unknown } })
      .queue;
    const add = vi.spyOn(queue, 'add').mockResolvedValue(undefined);
    const run = vi
      .spyOn(backfill(), 'run')
      .mockResolvedValueOnce({ derived: 20, failed: 0, skipped: 0, more: true })
      .mockResolvedValueOnce({ derived: 3, failed: 0, skipped: 0, more: false });

    await processor.process({ name: ROUTES_DERIVE_JOB } as Job);
    expect(add).toHaveBeenCalledWith(
      ROUTES_DERIVE_JOB,
      {},
      { jobId: 'routes.derive.more', removeOnComplete: true, removeOnFail: true },
    );
    await processor.process({ name: ROUTES_DERIVE_JOB } as Job);
    expect(add).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);

    await expect(processor.process({ name: 'other' } as Job)).rejects.toThrow(/unknown job other/);
  });
});
