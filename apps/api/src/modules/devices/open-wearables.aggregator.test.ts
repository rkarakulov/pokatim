import { createHmac, randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FAKE_OW_API_KEY, type FakeOw, startFakeOw } from '../../../test/fake-ow';
import { OpenWearablesAggregator, OW_API_KEY_HEADER } from './open-wearables.aggregator';
import { AggregatorError, TrackTooLongError, WebhookSignatureError } from './wearables-aggregator';

const NOW = new Date('2026-10-25T12:00:00Z');
const clock = { now: () => NOW };
// публичный тестовый вектор Svix, не секрет
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // gitleaks:allow

let ow: FakeOw;
let adapter: OpenWearablesAggregator;
const make = (overrides: { timeoutMs?: number; maxBodyBytes?: number; apiKey?: string } = {}) =>
  new OpenWearablesAggregator(
    { apiUrl: ow.url, apiKey: FAKE_OW_API_KEY, webhookSecret: SECRET, ...overrides },
    clock,
  );

beforeAll(async () => {
  ow = await startFakeOw();
});
afterAll(async () => {
  await ow.stop();
});
beforeEach(() => {
  ow.reset();
  adapter = make();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Ответ фейка — произвольное тело записанного ответа OW. */
const recorded = (route: string, body: unknown, status = 200) =>
  ow.fail(route, status, 1, { body: JSON.stringify(body) });

const failure = async (promise: Promise<unknown>): Promise<AggregatorError> => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AggregatorError))
    throw new Error(`expected AggregatorError: ${String(error)}`);
  return error;
};

const collect = async <T>(items: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
};

describe('OpenWearablesAggregator: запросы и разбор ответов OW 0.9', () => {
  it('каталог провайдеров: поля provider/name/is_enabled/live_sync_mode, лишние поля игнорируются', async () => {
    recorded('GET /oauth/providers', [
      {
        provider: 'garmin',
        name: 'Garmin',
        has_cloud_api: true,
        is_enabled: true,
        icon_url: '/static/provider-icons/garmin.svg',
        live_sync_mode: 'webhook',
        live_sync_configurable: true,
        data_granularity: 'raw',
      },
      {
        provider: 'apple',
        name: 'Apple Health',
        has_cloud_api: false,
        is_enabled: false,
        live_sync_mode: null,
      },
    ]);
    expect(await adapter.listProviders()).toEqual([
      { provider: 'garmin', name: 'Garmin', enabled: true, liveSync: 'webhook' },
      { provider: 'apple', name: 'Apple Health', enabled: false, liveSync: null },
    ]);
  });

  it('ключ — заголовок X-Open-Wearables-API-Key; пользователь создаётся только с external_user_id', async () => {
    const id = await adapter.ensureUser('pokatim:0190e6a2-0000-7000-8000-000000000001');
    expect(ow.users.get(id)).toEqual({
      externalUserId: 'pokatim:0190e6a2-0000-7000-8000-000000000001',
    });
    const [call] = ow.callsTo('POST /users');
    expect(call?.body).toEqual({
      external_user_id: 'pokatim:0190e6a2-0000-7000-8000-000000000001',
    });
  });

  it('повтор ensureUser (OW: 400 IntegrityError на уникальном external_user_id) — поиск по external_user_id', async () => {
    const first = await adapter.ensureUser('pokatim:a');
    await adapter.ensureUser('pokatim:b');
    expect(await adapter.ensureUser('pokatim:a')).toBe(first);
    const lookup = ow.callsTo('GET /users').at(-1);
    expect(lookup?.query.get('external_user_id')).toBe('pokatim:a');
    expect(ow.users.size).toBe(2);
  });

  it('authorize: user_id и redirect_uri в query; authorization_url — только https', async () => {
    const userId = await adapter.ensureUser('pokatim:a');
    const result = await adapter.createAuthorization({
      aggUserId: userId,
      provider: 'garmin',
      redirectUri: 'https://api.test/v1/devices/callback?t=abc',
    });
    expect(result.authorizeUrl).toMatch(/^https:\/\/connect\.provider\.test\//);
    expect(ow.redirectUris.get(userId)).toBe('https://api.test/v1/devices/callback?t=abc');

    ow.fail('GET /oauth/garmin/authorize', 200, 1, {
      body: JSON.stringify({ authorization_url: 'http://plain.test/x', state: 's' }),
    });
    const error = await failure(
      adapter.createAuthorization({
        aggUserId: userId,
        provider: 'garmin',
        redirectUri: 'https://a.test/',
      }),
    );
    expect(error.kind).toBe('protocol');
  });

  it('подключения: статусы active/expired/revoked, незнакомый — expired', async () => {
    const userId = randomUUID();
    recorded(`GET /users/{id}/connections`, [
      { provider: 'garmin', status: 'active', id: randomUUID(), user_id: userId },
      { provider: 'wahoo', status: 'paused' },
    ]);
    expect(await adapter.listConnections(userId)).toEqual([
      { provider: 'garmin', status: 'active' },
      { provider: 'wahoo', status: 'expired' },
    ]);
  });

  it('отзыв: 204 — успех, 404 (подключения нет) — тоже успех, 500 — повторяемая ошибка', async () => {
    const userId = randomUUID();
    ow.authorize(userId, 'garmin');
    await adapter.revokeConnection(userId, 'garmin');
    expect(ow.connections.get(userId)?.get('garmin')).toBe('revoked');
    await expect(adapter.revokeConnection(userId, 'wahoo')).resolves.toBeUndefined();
    ow.fail('DELETE /users/{id}/connections/garmin', 503);
    const error = await failure(adapter.revokeConnection(userId, 'garmin'));
    expect([error.kind, error.retryable]).toEqual(['unavailable', true]);
  });

  it('историческая выгрузка: путь /providers/{p}/users/{id}/sync/historical?days; 400 — не поддерживается', async () => {
    const userId = randomUUID();
    expect(await adapter.requestHistoricalSync(userId, 'garmin', 30)).toBe(true);
    const [call] = ow.callsTo('POST /providers/garmin/users/{id}/sync/historical');
    expect(call?.query.get('days')).toBe('30');
    ow.historicalSupported.delete('wahoo');
    expect(await adapter.requestHistoricalSync(userId, 'wahoo', 30)).toBe(false);
  });

  it('sync: POST /providers/{p}/users/{id}/sync?data_type=workouts', async () => {
    await adapter.requestSync(randomUUID(), 'wahoo');
    const [call] = ow.callsTo('POST /providers/wahoo/users/{id}/sync');
    expect(call?.query.get('data_type')).toBe('workouts');
  });
});

describe('OpenWearablesAggregator: тренировки', () => {
  const workoutRow = (overrides: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    type: 'cycling',
    name: 'Morning Ride',
    start_time: '2026-10-24T08:00:00Z',
    end_time: '2026-10-24T09:30:00Z',
    zone_offset: '+03:00',
    duration_seconds: 5400,
    source: { provider: 'garmin', source: 'garmin_connect', device: 'Edge 840', device_type: null },
    distance_meters: 42000.5,
    avg_heart_rate_bpm: 142,
    max_heart_rate_bpm: 171,
    average_watts: null,
    ...overrides,
  });
  const pageOf = (data: unknown[], nextCursor: string | null) => ({
    data,
    pagination: {
      next_cursor: nextCursor,
      previous_cursor: null,
      has_more: nextCursor !== null,
      total_count: null,
    },
    metadata: { resolution: null, sample_count: data.length },
  });

  it('даты обязательны (start_date/end_date), курсор до has_more=false; провайдер — source.provider; без значений пульса', async () => {
    const userId = randomUUID();
    const a = workoutRow();
    const b = workoutRow({
      type: 'Mountain_Biking',
      source: { provider: 'Wahoo' },
      avg_heart_rate_bpm: null,
      average_watts: 210.5,
      end_time: null,
    });
    recorded('GET /users/{id}/events/workouts', pageOf([a], 'c2'));
    recorded('GET /users/{id}/events/workouts', pageOf([b], null));
    const result = await collect(
      adapter.listWorkouts(userId, { from: new Date('2026-09-25T10:00:00Z'), to: NOW }),
    );

    const calls = ow.callsTo('GET /users/{id}/events/workouts');
    expect(calls.map((call) => Object.fromEntries(call.query))).toEqual([
      { start_date: '2026-09-25', end_date: '2026-10-25', limit: '100' },
      { start_date: '2026-09-25', end_date: '2026-10-25', limit: '100', cursor: 'c2' },
    ]);
    expect(result).toEqual([
      {
        id: a.id,
        provider: 'garmin',
        type: 'cycling',
        startedAt: new Date('2026-10-24T08:00:00Z'),
        endedAt: new Date('2026-10-24T09:30:00Z'),
        durationSec: 5400,
        hasHeartRate: true,
        hasPower: false,
      },
      {
        id: b.id,
        provider: 'wahoo',
        type: 'mountain_biking',
        startedAt: new Date('2026-10-24T08:00:00Z'),
        endedAt: null,
        durationSec: 5400,
        hasHeartRate: false,
        hasPower: true,
      },
    ]);
  });

  it('тренировка без обязательной даты старта — пропускается, остальные приходят', async () => {
    ow.fail('GET /users/{id}/events/workouts', 200, 1, {
      body: JSON.stringify(
        pageOf(
          [workoutRow({ start_time: null }), workoutRow({ id: 'not-uuid' }), workoutRow()],
          null,
        ),
      ),
    });
    const result = await collect(adapter.listWorkouts(randomUUID(), { from: NOW, to: NOW }));
    expect(result).toHaveLength(1);
  });

  it('конверт страницы не по схеме — protocol', async () => {
    ow.fail('GET /users/{id}/events/workouts', 200, 1, { body: JSON.stringify({ items: [] }) });
    const error = await failure(
      collect(adapter.listWorkouts(randomUUID(), { from: NOW, to: NOW })),
    );
    expect(error.kind).toBe('protocol');
  });
});

describe('OpenWearablesAggregator: трек /timeseries', () => {
  const userId = randomUUID();
  const window = { from: new Date('2026-10-24T08:00:00Z'), to: new Date('2026-10-24T09:00:00Z') };
  const t = (sec: number) => Date.parse('2026-10-24T08:00:00Z') + sec * 1000;

  it('types — повторяемый параметр (latitude, longitude, elevation), resolution=raw, provider; без пульса и мощности', async () => {
    ow.addTrack(userId, 'garmin', [[t(0), 53.9, 27.56, 220]]);
    await adapter.fetchWorkoutTrack(userId, 'garmin', window, 300_000);
    const [call] = ow.callsTo('GET /users/{id}/timeseries');
    expect(call?.query.getAll('types')).toEqual(['latitude', 'longitude', 'elevation']);
    expect(Object.fromEntries([...(call?.query ?? [])].filter(([key]) => key !== 'types'))).toEqual(
      {
        start_time: '2026-10-24T08:00:00.000Z',
        end_time: '2026-10-24T09:00:00.000Z',
        resolution: 'raw',
        provider: 'garmin',
        limit: '1000',
      },
    );
  });

  it('широта и долгота — пары по одной метке времени, высота — по ней же или null; все точки (курсор, без децимации)', async () => {
    const points: [number, number, number, number | null][] = Array.from(
      { length: 1500 },
      (_, i) => [t(i), 53.9 + i * 1e-5, 27.56 + i * 1e-5, i % 2 === 0 ? 200 + i : null],
    );
    ow.addTrack(userId, 'garmin', points);
    // широта без пары и чужой провайдер не попадают в трек
    ow.samples.get(userId)?.push({
      timestamp: new Date(t(5000)).toISOString(),
      type: 'latitude',
      value: 1,
      provider: 'garmin',
    });
    ow.addTrack(userId, 'wahoo', [[t(1), 1, 1, 1]]);

    const track = await adapter.fetchWorkoutTrack(
      userId,
      'garmin',
      { from: window.from, to: new Date(t(6000)) },
      300_000,
    );
    expect(track).toHaveLength(1500);
    expect(track[0]).toEqual([t(0), 53.9, 27.56, 200]);
    expect(track[1]?.[3]).toBeNull();
    expect(track[1499]?.[0]).toBe(t(1499));
    expect(ow.callsTo('GET /users/{id}/timeseries').length).toBeGreaterThan(1);
  });

  it('больше лимита точек — TrackTooLongError', async () => {
    ow.addTrack(
      userId,
      'garmin',
      Array.from({ length: 30 }, (_, i): [number, number, number, null] => [t(i), 53, 27, null]),
    );
    await expect(adapter.fetchWorkoutTrack(userId, 'garmin', window, 10)).rejects.toBeInstanceOf(
      TrackTooLongError,
    );
  });
});

describe('OpenWearablesAggregator: ошибки и защита исходящих запросов', () => {
  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [404, 'not_found', false],
    [400, 'rejected', false],
    [429, 'unavailable', true],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
  ] as const)('HTTP %i → %s (повтор: %s)', async (status, kind, retryable) => {
    ow.fail('GET /users/{id}/connections', status);
    const error = await failure(adapter.listConnections(randomUUID()));
    expect([error.kind, error.status, error.retryable]).toEqual([kind, status, retryable]);
  });

  it('неверный ключ: 401 → auth, лог ow.auth_failed без значения ключа', async () => {
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const wrongKey = 'wrong-key-wrong-key-0000000000';
    const error = await failure(make({ apiKey: wrongKey }).listConnections(randomUUID()));
    expect(error.kind).toBe('auth');
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toContain('ow.auth_failed');
    expect(logged).not.toContain(wrongKey);
    expect(logged).not.toContain(OW_API_KEY_HEADER);
    expect(error.message).not.toContain(wrongKey);
  });

  it('редирект не выполняется: 302 → protocol, запрос на Location не уходит', async () => {
    ow.fail('GET /users/{id}/connections', 302, 1, {
      headers: { location: 'http://169.254.169.254/' },
      body: '',
    });
    const error = await failure(adapter.listConnections(randomUUID()));
    expect(error.kind).toBe('protocol');
  });

  it('тело больше лимита — protocol (потоковый счётчик)', async () => {
    ow.fail('GET /users/{id}/connections', 200, 1, {
      body: JSON.stringify([{ provider: 'garmin', status: 'active', padding: 'x'.repeat(4096) }]),
    });
    const error = await failure(make({ maxBodyBytes: 1024 }).listConnections(randomUUID()));
    expect(error.kind).toBe('protocol');
  });

  it('таймаут — unavailable (повторяемая)', async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    ow.hold('GET /users/{id}/connections', () => released);
    const error = await failure(make({ timeoutMs: 50 }).listConnections(randomUUID()));
    release();
    expect([error.kind, error.retryable]).toEqual(['unavailable', true]);
  });

  it('недоступный адрес — unavailable', async () => {
    const offline = new OpenWearablesAggregator(
      { apiUrl: 'http://127.0.0.1:9', apiKey: FAKE_OW_API_KEY, webhookSecret: null },
      clock,
    );
    expect((await failure(offline.listProviders())).kind).toBe('unavailable');
  });

  it('id пользователя OW в пути — только UUID', async () => {
    expect((await failure(adapter.listConnections('../oauth/providers'))).kind).toBe('protocol');
    expect(ow.calls).toHaveLength(0);
  });
});

describe('OpenWearablesAggregator: вебхук', () => {
  const sign = (body: string, timestamp = Math.floor(NOW.getTime() / 1000)) => {
    const signature = createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64'))
      .update(`msg_1.${timestamp}.${body}`)
      .digest('base64');
    return {
      'svix-id': 'msg_1',
      'svix-timestamp': String(timestamp),
      'svix-signature': `v1,${signature}`,
    };
  };

  it('верная подпись — тип события и data.user_id (без остальных данных тела)', () => {
    const userId = randomUUID();
    const body = JSON.stringify({
      type: 'workout.created',
      data: { id: randomUUID(), user_id: userId, source: { provider: 'garmin' } },
    });
    expect(adapter.verifyWebhook(sign(body), Buffer.from(body))).toEqual({
      aggUserId: userId,
      type: 'workout.created',
    });
  });

  it('неверная подпись или нет секрета — WebhookSignatureError', () => {
    const body = '{"type":"workout.created","data":{}}';
    expect(() => adapter.verifyWebhook(sign(body), Buffer.from(`${body} `))).toThrow(
      WebhookSignatureError,
    );
    const noSecret = new OpenWearablesAggregator(
      { apiUrl: ow.url, apiKey: FAKE_OW_API_KEY, webhookSecret: null },
      clock,
    );
    expect(() => noSecret.verifyWebhook(sign(body), Buffer.from(body))).toThrow(
      WebhookSignatureError,
    );
  });

  it('user_id не UUID — адресата нет', () => {
    const body = JSON.stringify({ type: 'sync.completed', data: { user_id: 'pokatim:x' } });
    expect(adapter.verifyWebhook(sign(body), Buffer.from(body)).aggUserId).toBeNull();
  });
});
