import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { trackLengthMeters } from '@pokatim/tracks';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import { type Db, MongoServerError } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activities,
  type Connected,
  connectActive,
  createDevicesHarness,
  devices,
  disconnect,
  jobOf,
  listDevices,
  pendingPulls,
  processUpload,
  rider,
  rideTrack,
  runOutbox,
  syncNow,
  syncService,
  trackUploads,
} from '../../../test/devices';
import { type FakeOw, type FakeOwWorkout, startFakeOw } from '../../../test/fake-ow';
import { DAY, type Harness, HOUR } from '../../../test/harness';
import { call, gate, outboxEvents } from '../../../test/identity';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import {
  TRACK_INGEST,
  type TrackIngest,
  TrackSourceDeletedError,
  TrackStorageFullError,
} from '../tracks';
import { DevicesLocks } from './devices-jobs';
import { DevicesMaintenanceProcessor } from './devices-maintenance.processor';
import { PullRetryError } from './devices-sync.service';
import { devicesCollections } from './devices.collection';
import { DevicesRepository } from './devices.repository';
import {
  TrackTooLongError,
  WEARABLES_AGGREGATOR,
  type WearablesAggregator,
} from './wearables-aggregator';
import { waitUntil } from '../../../test/wait';

let ow: FakeOw;
let h: Harness;
let alice: Connected;

beforeAll(async () => {
  ow = await startFakeOw();
  h = await createDevicesHarness(ow);
});
beforeEach(async () => {
  await h.reset();
  ow.reset();
  alice = await connectActive(h, ow, await rider(h));
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await ow.stop();
});

const hoursAgo = (hours: number) => new Date(h.clock.now().getTime() - hours * HOUR);
const pull = (attemptsMade = 0) =>
  syncService(h).pull(alice.connectionId, { final: attemptsMade >= 4 });

/** Тренировка Garmin с треком в OW. */
function ride(start: Date, overrides: Partial<FakeOwWorkout> = {}) {
  const points = rideTrack(start);
  const workout = ow.addWorkout(alice.aggUserId, {
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + points.length * 1000).toISOString(),
    duration_seconds: points.length,
    ...overrides,
  });
  ow.addTrack(alice.aggUserId, workout.source.provider, points);
  return { workout, points };
}

/** Файлы хранилища треков (рекурсивно; каталога ещё нет — пусто). */
const storedFiles = async (): Promise<string[]> =>
  (await readdir(TRACK_STORAGE_DIR_TEST, { recursive: true, withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

const imports = () => devices(h).imports.find().sort({ firstSeenAt: 1, _id: 1 }).toArray();

describe('pull и импорт (AC8)', () => {
  it('cycling и mountain_biking — импорт с треком из /timeseries (все точки), source = провайдер; running и чужой провайдер — без записи; indoor без координат — skipped', async () => {
    const road = ride(hoursAgo(30), { avg_heart_rate_bpm: 140, average_watts: 205 });
    const mtb = ride(hoursAgo(20), { type: 'mountain_biking' });
    ow.addWorkout(alice.aggUserId, {
      type: 'running',
      start_time: hoursAgo(10).toISOString(),
      duration_seconds: 1800,
    });
    ow.addWorkout(alice.aggUserId, {
      type: 'cycling',
      start_time: hoursAgo(9).toISOString(),
      duration_seconds: 1800,
      source: { provider: 'wahoo', device: null },
    });
    const indoor = ow.addWorkout(alice.aggUserId, {
      type: 'indoor_cycling',
      start_time: hoursAgo(8).toISOString(),
      duration_seconds: 3600,
    });

    expect(await pull()).toBe('done');

    const rows = await imports();
    expect(rows.map((row) => [row.aggWorkoutId, row.status, row.reason]).sort()).toEqual(
      [
        [road.workout.id, 'imported', null],
        [mtb.workout.id, 'imported', null],
        [indoor.id, 'skipped', 'no_track'],
      ].sort(),
    );
    const uploads = await trackUploads(h).find().toArray();
    expect(uploads.map((upload) => [upload.source, upload.sourceRef]).sort()).toEqual(
      [
        ['garmin', road.workout.id],
        ['garmin', mtb.workout.id],
      ].sort(),
    );

    // тот же разбор, что у ручной загрузки: активность из потока, дистанция потока, все точки без децимации
    const roadUpload = uploads.find((upload) => upload.sourceRef === road.workout.id);
    expect(await processUpload(h, roadUpload?._id ?? '')).toBe('ready');
    const activity = await activities(h).findOne({ uploadId: roadUpload?._id });
    expect(activity).toMatchObject({
      source: 'garmin',
      sport: 'cycling',
      hasHeartRate: true,
      hasPower: true,
    });
    const expected = trackLengthMeters(road.points.map(([, lat, lon]) => ({ lat, lon })));
    expect(Math.abs((activity?.distanceM ?? 0) - expected) / expected).toBeLessThan(0.01);
    expect(
      await h.db.collection('activity_tracks').findOne({ userId: alice.userId }),
    ).toMatchObject({
      sourcePointCount: 600,
    });

    // запросы трека — только координаты и высота, raw, провайдер подключения
    const series = ow
      .callsTo('GET /users/{id}/timeseries')
      .map((item) => item.query.getAll('types'));
    expect(new Set(series.flat())).toEqual(new Set(['latitude', 'longitude', 'elevation']));
  });

  it('повторный pull — без дублей импорта и загрузок; трек повторно не запрашивается', async () => {
    ride(hoursAgo(30));
    await pull();
    const timeseries = ow.callsTo('GET /users/{id}/timeseries').length;
    await pull();
    expect(await devices(h).imports.countDocuments()).toBe(1);
    expect(await trackUploads(h).countDocuments()).toBe(1);
    expect(ow.callsTo('GET /users/{id}/timeseries')).toHaveLength(timeseries);
  });

  it('первые 48 ч — окно 30 дней; затем — от lastSyncedAt − 1 сут', async () => {
    const dates = () => {
      const last = ow.callsTo('GET /users/{id}/events/workouts').at(-1);
      return [last?.query.get('start_date'), last?.query.get('end_date')];
    };
    await pull();
    expect(dates()).toEqual(['2026-09-22', '2026-10-22']);
    h.clock.advance(47 * HOUR);
    await pull();
    expect(dates()).toEqual(['2026-09-24', '2026-10-24']);

    h.clock.advance(2 * HOUR); // catch-up закончился; lastSyncedAt — 2026-10-24T08:00Z
    await pull();
    expect(dates()).toEqual(['2026-10-23', '2026-10-24']);
    expect(
      (await devices(h).connections.findOne({ _id: alice.connectionId }))?.lastSyncedAt,
    ).toEqual(h.clock.now());
  });

  it('тренировка старше окна не запрашивается (фильтр OW), длиннее 48 ч — skipped too_long', async () => {
    ow.addWorkout(alice.aggUserId, {
      start_time: new Date(h.clock.now().getTime() - 3 * DAY).toISOString(),
      duration_seconds: 49 * 3600,
    });
    await pull();
    expect((await imports()).map((row) => [row.status, row.reason])).toEqual([
      ['skipped', 'too_long'],
    ]);
  });

  it('429/5xx OW при списке тренировок — повторяемая ошибка задачи; финальная попытка — issue sync_failed', async () => {
    ow.fail('GET /users/{id}/events/workouts', 429);
    await expect(pull()).rejects.toMatchObject({ kind: 'unavailable', retryable: true });
    expect((await devices(h).connections.findOne({ _id: alice.connectionId }))?.issue).toBeNull();
    ow.fail('GET /users/{id}/events/workouts', 503);
    await expect(pull(4)).rejects.toMatchObject({ kind: 'unavailable' });
    expect((await devices(h).connections.findOne({ _id: alice.connectionId }))?.issue).toBe(
      'sync_failed',
    );
  });

  it('401 OW (ключ) — без повторов (UnrecoverableError) и issue sync_failed', async () => {
    ow.fail('GET /users/{id}/events/workouts', 401);
    await expect(pull()).rejects.toMatchObject({ name: 'UnrecoverableError' });
    expect((await devices(h).connections.findOne({ _id: alice.connectionId }))?.issue).toBe(
      'sync_failed',
    );
  });

  it('5 провалов импорта тренировки — issue sync_failed, дальше тренировка не запрашивается; lastSyncedAt не двигается', async () => {
    ride(hoursAgo(30));
    ow.fail('GET /users/{id}/timeseries', 500, 6);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(pull()).rejects.toBeInstanceOf(PullRetryError);
      expect((await imports())[0]).toMatchObject({ status: 'failed', attempts: attempt });
    }
    const connection = await devices(h).connections.findOne({ _id: alice.connectionId });
    expect(connection).toMatchObject({ issue: 'sync_failed', lastSyncedAt: null });
    const calls = ow.callsTo('GET /users/{id}/timeseries').length;
    expect(await pull()).toBe('done');
    expect(ow.callsTo('GET /users/{id}/timeseries')).toHaveLength(calls);
    expect((await devices(h).connections.findOne({ _id: alice.connectionId }))?.issue).toBe(
      'sync_failed',
    );
  });

  it('хранилище заполнено — импорт failed (storage), отложенный повтор задачи; следующий pull импортирует', async () => {
    ride(hoursAgo(30));
    const ingest = h.worker.get<TrackIngest>(TRACK_INGEST);
    const spy = vi
      .spyOn(ingest, 'ingestProviderStream')
      .mockRejectedValueOnce(new TrackStorageFullError());
    await expect(pull()).rejects.toBeInstanceOf(PullRetryError);
    expect((await imports())[0]).toMatchObject({ status: 'failed', reason: 'storage' });
    spy.mockRestore();
    expect(await pull()).toBe('done');
    expect((await imports())[0]).toMatchObject({ status: 'imported', attempts: 2 });
  });

  it('трек длиннее лимита — skipped too_many_points без загрузки', async () => {
    ride(hoursAgo(30));
    const aggregator = h.worker.get<WearablesAggregator>(WEARABLES_AGGREGATOR);
    vi.spyOn(aggregator, 'fetchWorkoutTrack').mockRejectedValueOnce(new TrackTooLongError());
    await pull();
    expect((await imports())[0]).toMatchObject({ status: 'skipped', reason: 'too_many_points' });
    expect(await trackUploads(h).countDocuments()).toBe(0);
  });

  it('pending и отключённые подключения не импортируются; параллельный pull того же подключения — busy', async () => {
    ride(hoursAgo(30));
    const hold = gate();
    ow.hold('GET /users/{id}/events/workouts', hold.wait);
    const first = pull();
    await hold.reached;
    expect(await pull()).toBe('busy');
    hold.open();
    expect(await first).toBe('done');

    await disconnect(h, alice);
    expect(await pull()).toBe('inactive');
  });
});

describe('«Синхронизировать сейчас» (AC8)', () => {
  it('requestSync в OW + pull через 30 с и 3 мин; чаще 1/10 мин — 429', async () => {
    const response = await syncNow(h, alice);
    expect(response.status).toBe(200);
    expect(ow.callsTo('POST /providers/garmin/users/{id}/sync')).toHaveLength(1);
    const delays = (await pendingPulls(h)).map((job) => job.opts.delay).sort();
    expect(delays).toEqual([180_000, 30_000].sort());

    const limited = await syncNow(h, alice);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
  });

  it('OW не принял requestSync — pull всё равно поставлен; не подключено — 404', async () => {
    ow.fail('POST /providers/garmin/users/{id}/sync', 500);
    expect((await syncNow(h, alice)).status).toBe(200);
    expect(await pendingPulls(h)).toHaveLength(2);
    expect((await syncNow(h, alice, 'wahoo')).status).toBe(404);
  });

  it('расписание ставит pull активным подключениям без накопления (дедупликация ow-pull)', async () => {
    const maintenance = h.worker.get(DevicesMaintenanceProcessor);
    await maintenance.process(jobOf('schedule-pull', {}));
    await maintenance.process(jobOf('schedule-pull', {}));
    expect((await pendingPulls(h)).map((job) => job.data)).toEqual([
      { connectionId: alice.connectionId },
    ]);
  });

  it('сверка: в OW подключение истекло — issue reauthorize и журнал; экран показывает проблему', async () => {
    ow.connections.get(alice.aggUserId)?.set('garmin', 'expired');
    expect(await h.worker.get(DevicesMaintenanceProcessor).process(jobOf('reconcile', {}))).toBe(1);
    expect(await h.worker.get(DevicesMaintenanceProcessor).process(jobOf('reconcile', {}))).toBe(0);
    const garmin = (await listDevices(h, alice)).body as {
      items: { provider: string; issue: string | null }[];
    };
    expect(garmin.items.find((item) => item.provider === 'garmin')?.issue).toBe('reauthorize');
    expect((await devices(h).audit.find({ action: 'reauthorize_required' }).toArray()).length).toBe(
      1,
    );
  });
});

describe('удаление загрузки ↔ pull: без воскрешения (AC5, гонка 4)', () => {
  const deleteUpload = (uploadId: string) =>
    call(h, 'POST', `/v1/tracks/uploads/${uploadId}/delete`, undefined, alice.auth);

  it('удалённая загрузка → надгробие device_imports.deleted; следующий pull её не возвращает', async () => {
    ride(hoursAgo(30));
    await pull();
    const [upload] = await trackUploads(h).find().toArray();
    expect((await deleteUpload(upload?._id ?? '')).status).toBe(204);
    // pull до обработки события: импорт `imported` — не повторяется
    await pull();
    expect(await trackUploads(h).countDocuments()).toBe(0);
    expect(await runOutbox(h, 'tracks.upload-deleted')).toEqual(['tombstoned']);
    expect((await imports())[0]).toMatchObject({ status: 'deleted', reason: 'upload_deleted' });
    await pull();
    expect(await trackUploads(h).countDocuments()).toBe(0);
  });

  it('удаление и надгробие посреди pull (после приёма трека, до отметки импорта) — отметка не перезаписывает надгробие', async () => {
    ride(hoursAgo(30));
    const repository = h.worker.get(DevicesRepository);
    const finish = gate();
    const original = repository.finishImport.bind(repository);
    vi.spyOn(repository, 'finishImport').mockImplementation(async (...args) => {
      await finish.wait();
      return original(...args);
    });
    const running = pull();
    await finish.reached;
    const [upload] = await trackUploads(h).find().toArray();
    expect((await deleteUpload(upload?._id ?? '')).status).toBe(204);
    expect(await runOutbox(h, 'tracks.upload-deleted')).toEqual(['tombstoned']);
    finish.open();
    expect(await running).toBe('done');

    expect((await imports())[0]).toMatchObject({ status: 'deleted' });
    vi.mocked(repository.finishImport).mockRestore();
    await pull();
    expect(await trackUploads(h).countDocuments()).toBe(0);
  });

  it('отключение с галочкой — загрузки провайдера удалены (и помечены надгробиями); без галочки — остаются', async () => {
    ride(hoursAgo(30));
    await pull();
    expect(await trackUploads(h).countDocuments()).toBe(1);
    await disconnect(h, alice, 'garmin', true);
    expect(await runOutbox(h, 'devices.revoke-requested')).toEqual(['revoked']);
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(0);
    expect(await runOutbox(h, 'tracks.upload-deleted')).toEqual(['tombstoned']);
  });

  it('отключение без галочки — заезды остаются', async () => {
    ride(hoursAgo(30));
    await pull();
    await disconnect(h, alice);
    await runOutbox(h, 'devices.revoke-requested');
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(1);
  });
});

describe('отзыв с удалением ↔ pull: заезд не возвращается (замок подключения + эпоха)', () => {
  /**
   * Pull стоит на запросе трека в OW (после списка тренировок и захвата импорта); пользователь отключает с галочкой,
   * задача отзыва стартует; затем OW отвечает. `blocked` — отзыв дошёл до замка (или, без замка, завершился).
   */
  async function race(options: { lock: boolean; epoch: boolean }) {
    ride(hoursAgo(30));
    const locks = h.worker.get(DevicesLocks);
    const repository = h.worker.get(DevicesRepository);
    if (!options.epoch) {
      vi.spyOn(repository, 'isActiveEpoch').mockResolvedValue(true);
      // барьер эпохи в транзакции приёма (ревью pass 2) — тоже снят
      vi.spyOn(repository, 'touchActiveEpoch').mockResolvedValue(true);
    }
    const acquire = vi.spyOn(locks, 'acquire');
    if (!options.lock) {
      acquire.mockResolvedValue('no-lock');
      vi.spyOn(locks, 'release').mockResolvedValue();
    }
    const track = gate();
    ow.hold('GET /users/{id}/timeseries', track.wait);
    const pulling = pull();
    await track.reached;
    expect((await disconnect(h, alice, 'garmin', true)).status).toBe(200);
    let revokeSettled = false;
    const revoking = runOutbox(h, 'devices.revoke-requested').finally(() => (revokeSettled = true));
    await waitUntil(() => {
      if (acquire.mock.calls.length === 0 && !revokeSettled)
        throw new Error('отзыв не дошёл до замка');
    });
    track.open();
    const [pulled, revoked] = await Promise.all([pulling, revoking]);
    return { pulled, revoked };
  }

  it('отзыв ждёт текущий импорт под замком devices:pull, проверка эпохи не даёт импорту создать загрузку', async () => {
    const { pulled, revoked } = await race({ lock: true, epoch: true });
    expect(pulled).toBe('inactive');
    expect(revoked).toEqual(['revoked']);
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(0);
    expect(await devices(h).connections.findOne({ _id: alice.connectionId })).toMatchObject({
      status: 'revoked',
    });
  });

  it('только замок (без проверки эпохи): отзыв удаляет загрузку после импорта — загрузок 0', async () => {
    const { revoked } = await race({ lock: true, epoch: false });
    expect(revoked).toEqual(['revoked']);
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(0);
  });

  it('только проверка эпохи (без замка): импорт видит отключение и не создаёт загрузку', async () => {
    const { pulled } = await race({ lock: false, epoch: true });
    expect(pulled).toBe('inactive');
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(0);
  });

  it('отрицательное доказательство: без замка и без проверки эпохи — заезд вернулся после отзыва с удалением', async () => {
    const { revoked } = await race({ lock: false, epoch: false });
    expect(revoked).toEqual(['revoked']);
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(1);
  });

  /**
   * Ревью pass 2 (H3): проверка эпохи прошла, приём приостановлен, lease замка pull истёк, отзыв с удалением завершён
   * целиком — приём продолжается. Барьер эпохи в транзакции приёма (`touchActiveEpoch`) не даёт создать загрузку.
   */
  async function leaseExpiredRace(barrier: boolean) {
    ride(hoursAgo(30));
    const ingest = h.worker.get<TrackIngest>(TRACK_INGEST);
    const repository = h.worker.get(DevicesRepository);
    if (!barrier) vi.spyOn(repository, 'touchActiveEpoch').mockResolvedValue(true);
    const original = ingest.ingestProviderStream.bind(ingest);
    const paused = gate();
    vi.spyOn(ingest, 'ingestProviderStream').mockImplementationOnce(async (input) => {
      await paused.wait();
      return original(input);
    });
    const pulling = pull();
    await paused.reached;
    // lease замка pull истёк (SET PX без продления), отзыв берёт замок и завершается целиком
    await h.redis.del(`devices:pull:${alice.connectionId}`);
    expect((await disconnect(h, alice, 'garmin', true)).status).toBe(200);
    expect(await runOutbox(h, 'devices.revoke-requested')).toEqual(['revoked']);
    paused.open();
    return pulling;
  }

  it('H3: lease истёк, отзыв с удалением завершён до приёма — барьер эпохи в транзакции, загрузок 0', async () => {
    const filesBefore = await storedFiles();
    expect(await leaseExpiredRace(true)).toBe('inactive');
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(0);
    // отказ предусловия: файл, записанный до транзакции, удалён; события приёма в outbox нет
    expect(await storedFiles()).toEqual(filesBefore);
    expect((await outboxEvents(h)).map((event) => event.type)).not.toContain(
      'tracks.upload-received',
    );
    expect((await imports())[0]).toMatchObject({ status: 'failed', reason: 'connection_inactive' });
    expect(await devices(h).connections.findOne({ _id: alice.connectionId })).toMatchObject({
      status: 'revoked',
    });
  });

  it('H3, отрицательное доказательство: без барьера в транзакции приёма — загрузка после отзыва', async () => {
    await leaseExpiredRace(false);
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(1);
    expect(await devices(h).connections.findOne({ _id: alice.connectionId })).toMatchObject({
      status: 'revoked',
    });
  });

  /**
   * Ревью pass 3: write-write конфликт барьера. Транзакция приёма удерживается ПОСЛЕ записи барьера
   * (`touchActiveEpoch`, `$inc ingestSeq`), пользователь отключает с удалением. Транзакция отключения пишет тот же
   * документ подключения — конфликт записи, повтор до коммита приёма; отзыв идёт после и удаляет загрузку.
   * `barrier: 'read'` — барьер только читает подключение: конфликта нет, отключение и отзыв завершаются, пока приём
   * удерживается, — загрузка появляется после отзыва.
   */
  async function barrierConflictRace(barrier: 'write' | 'read') {
    ride(hoursAgo(30));
    const worker = h.worker.get(DevicesRepository);
    const api = h.app.get(DevicesRepository, { strict: false });
    const touch = worker.touchActiveEpoch.bind(worker);
    const workerConnections = devicesCollections(
      h.worker.get<Db>(MONGO_DB, { strict: false }),
    ).connections;
    const held = gate();
    let barrierHeld = false;
    vi.spyOn(worker, 'touchActiveEpoch').mockImplementation(async (session, id, connectedAt) => {
      const active =
        barrier === 'write'
          ? await touch(session, id, connectedAt)
          : // то же условие чтением в той же транзакции (сессия — клиента worker, не тестового)
            (await workerConnections.countDocuments(
              { _id: id, status: 'active', connectedAt },
              { session },
            )) === 1;
      // только первая попытка транзакции приёма удерживается после барьера; повторы драйвера — без ожидания
      if (!barrierHeld) {
        barrierHeld = true;
        await held.wait();
      }
      return active;
    });
    const conflicts: unknown[] = [];
    const requestDisconnect = api.requestDisconnect.bind(api);
    vi.spyOn(api, 'requestDisconnect').mockImplementation(async (...args) => {
      try {
        return await requestDisconnect(...args);
      } catch (error) {
        conflicts.push(error);
        throw error;
      }
    });

    const pulling = pull();
    await held.reached;
    let disconnected = false;
    const disconnecting = disconnect(h, alice, 'garmin', true).finally(() => (disconnected = true));
    await waitUntil(() => {
      if (conflicts.length === 0 && !disconnected) throw new Error('отключение не дошло до записи');
    });
    if (disconnected) {
      // конфликта нет: отключение закоммичено, пока приём удерживается; lease замка pull истёк — отзыв целиком
      await h.redis.del(`devices:pull:${alice.connectionId}`);
      expect(await runOutbox(h, 'devices.revoke-requested')).toEqual(['revoked']);
      held.open();
      await pulling;
      return { conflicts, status: (await disconnecting).status, uploadsBeforeRevoke: 0 };
    }
    held.open();
    const [, response] = await Promise.all([pulling, disconnecting]);
    // приём закоммичен раньше отключения (оно ждало конфликтом); отзыв после — удаляет загрузку
    const uploadsBeforeRevoke = await trackUploads(h).countDocuments({ source: 'garmin' });
    expect(await runOutbox(h, 'devices.revoke-requested')).toEqual(['revoked']);
    return { conflicts, status: response.status, uploadsBeforeRevoke };
  }

  it('pass 3: приём удерживается после записи барьера — отключение получает конфликт записи и повторяется, после отзыва загрузок 0', async () => {
    const { conflicts, status, uploadsBeforeRevoke } = await barrierConflictRace('write');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(
      conflicts.every(
        (error) =>
          error instanceof MongoServerError && error.hasErrorLabel('TransientTransactionError'),
      ),
    ).toBe(true);
    expect(status).toBe(200);
    expect(uploadsBeforeRevoke).toBe(1);
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(0);
    expect(await devices(h).connections.findOne({ _id: alice.connectionId })).toMatchObject({
      status: 'revoked',
    });
  });

  it('pass 3, отрицательное доказательство: барьер только читает — конфликта нет, загрузка после отзыва', async () => {
    const { conflicts, status } = await barrierConflictRace('read');
    expect(conflicts).toEqual([]);
    expect(status).toBe(200);
    expect(await trackUploads(h).countDocuments({ source: 'garmin' })).toBe(1);
    expect(await devices(h).connections.findOne({ _id: alice.connectionId })).toMatchObject({
      status: 'revoked',
    });
  });

  it('H3: lease потерян между тренировками — pull останавливается без импорта', async () => {
    ride(hoursAgo(30));
    vi.spyOn(h.worker.get(DevicesLocks), 'extend').mockResolvedValue(false);
    expect(await pull()).toBe('busy');
    expect(await imports()).toEqual([]);
    expect(await trackUploads(h).countDocuments()).toBe(0);
  });

  it('замок pull занят дольше ожидания — задача отзыва повторяется, подключение ждёт в disconnecting', async () => {
    await disconnect(h, alice, 'garmin', true);
    vi.spyOn(h.worker.get(DevicesLocks), 'acquire').mockResolvedValue(null);
    await expect(runOutbox(h, 'devices.revoke-requested')).rejects.toThrow(/busy/);
    expect(ow.callsTo('DELETE /users/{id}/connections/garmin')).toHaveLength(0);
    expect(await devices(h).connections.findOne({ _id: alice.connectionId })).toMatchObject({
      status: 'disconnecting',
    });
  });
});

describe('удалённый объект источника (TrackSourceDeletedError) — надгробие импорта без повторов', () => {
  const deleteUpload = (uploadId: string) =>
    call(h, 'POST', `/v1/tracks/uploads/${uploadId}/delete`, undefined, alice.auth);

  it('порт tracks отклонил приём (объект удалялся) — импорт deleted, без failed и sync_failed, дальше не запрашивается', async () => {
    ride(hoursAgo(30));
    const ingest = h.worker.get<TrackIngest>(TRACK_INGEST);
    const spy = vi
      .spyOn(ingest, 'ingestProviderStream')
      .mockRejectedValue(new TrackSourceDeletedError());
    expect(await pull()).toBe('done');
    expect((await imports())[0]).toMatchObject({
      status: 'deleted',
      reason: 'upload_deleted',
      uploadId: null,
      attempts: 1,
    });
    const connection = await devices(h).connections.findOne({ _id: alice.connectionId });
    expect(connection?.issue).toBeNull();
    expect(connection?.lastSyncedAt).toEqual(h.clock.now());
    const calls = ow.callsTo('GET /users/{id}/timeseries').length;
    expect(await pull()).toBe('done');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ow.callsTo('GET /users/{id}/timeseries')).toHaveLength(calls);
  });

  it('worker упал после приёма до отметки импорта → пользователь удалил загрузку → повтор pull до события удаления: заезд не вернулся', async () => {
    ride(hoursAgo(30));
    const repository = h.worker.get(DevicesRepository);
    // «падение» worker: ни одна отметка импорта не записана, попытка pull обрывается
    vi.spyOn(repository, 'finishImport').mockRejectedValue(new Error('worker crashed'));
    await expect(pull()).rejects.toThrow('worker crashed');
    vi.mocked(repository.finishImport).mockRestore();
    expect((await imports())[0]).toMatchObject({ status: 'queued', uploadId: null });
    const [upload] = await trackUploads(h).find().toArray();
    expect((await deleteUpload(upload?._id ?? '')).status).toBe(204);

    // событие tracks.upload-deleted ещё не обработано — надгробия в devices нет
    expect(await pull()).toBe('done');
    expect(await trackUploads(h).countDocuments()).toBe(0);
    expect((await imports())[0]).toMatchObject({ status: 'deleted' });
  });
});
