import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Connected,
  complete,
  connect,
  connectActive,
  createDevicesHarness,
  devices,
  listDevices,
  pendingPulls,
  rider,
  rideTrack,
  runOutbox,
  svixHeaders,
  syncNow,
  syncService,
  ticketFromOw,
  aggUserIdOf,
  WEBHOOK_SECRET,
} from '../../../test/devices';
import { FAKE_OW_API_KEY, type FakeOw, startFakeOw } from '../../../test/fake-ow';
import type { Harness } from '../../../test/harness';
import { call } from '../../../test/identity';

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

const send = (body: string, headers: Record<string, string>, ip = '203.0.113.7') =>
  h.app.inject({
    method: 'POST',
    url: '/v1/devices/webhook',
    payload: body,
    headers,
    remoteAddress: ip,
  });
const event = (userId: string, marker = 'body-marker') =>
  JSON.stringify({
    type: 'workout.created',
    data: {
      id: randomUUID(),
      user_id: userId,
      type: 'cycling',
      source: { provider: 'garmin', device: marker },
    },
  });

describe('POST /v1/devices/webhook (AC9)', () => {
  it('верная подпись, свой пользователь — pull поставлен; повтор вебхука не дублирует задачу', async () => {
    const body = event(alice.aggUserId);
    const first = await send(body, svixHeaders(body, h.clock.now()));
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    await send(body, svixHeaders(body, h.clock.now(), WEBHOOK_SECRET, 'msg_2'));
    expect((await pendingPulls(h)).map((job) => job.data)).toEqual([
      { connectionId: alice.connectionId },
    ]);
  });

  it('неверная подпись или подменённое тело — 401 без записи', async () => {
    const body = event(alice.aggUserId);
    const forged = await send(body, svixHeaders(`${body} `, h.clock.now()));
    expect(forged.statusCode).toBe(401);
    const wrongKey = await send(
      body,
      svixHeaders(body, h.clock.now(), `whsec_${Buffer.alloc(32, 1).toString('base64')}`),
    );
    expect(wrongKey.statusCode).toBe(401);
    const unsigned = await send(body, { 'content-type': 'application/json' });
    expect(unsigned.statusCode).toBe(401);
    expect(await pendingPulls(h)).toHaveLength(0);
  });

  it('старая метка (> 5 мин) — 401', async () => {
    const body = event(alice.aggUserId);
    const old = new Date(h.clock.now().getTime() - 6 * 60_000);
    expect((await send(body, svixHeaders(body, old))).statusCode).toBe(401);
    expect(await pendingPulls(h)).toHaveLength(0);
  });

  it('чужой или неизвестный user_id (общий инстанс OW) — 200 без записи', async () => {
    for (const userId of [randomUUID(), 'not-a-uuid']) {
      const body = event(userId);
      expect((await send(body, svixHeaders(body, h.clock.now()))).statusCode).toBe(200);
    }
    expect(await pendingPulls(h)).toHaveLength(0);
  });

  it('pending-подключение по вебхуку не импортируется', async () => {
    const bob = await rider(h, 'bob@example.com');
    await connect(h, bob);
    const body = event(await aggUserIdOf(h, bob.userId));
    expect((await send(body, svixHeaders(body, h.clock.now()))).statusCode).toBe(200);
    expect(await pendingPulls(h)).toHaveLength(0);
  });

  it('тело больше лимита — 413; IP-лимит 600/мин — 429', async () => {
    const big = JSON.stringify({ type: 'x', data: { pad: 'x'.repeat(300 * 1024) } });
    expect((await send(big, svixHeaders(big, h.clock.now()))).statusCode).toBe(413);

    await h.redis.flushdb();
    const body = event(randomUUID());
    const headers = svixHeaders(body, h.clock.now());
    const statuses = new Set<number>();
    for (let i = 0; i < 601; i += 1)
      statuses.add((await send(body, headers, '198.51.100.9')).statusCode);
    expect([...statuses].sort()).toEqual([200, 429]);
    expect((await send(body, headers, '198.51.100.10')).statusCode).toBe(200);
  });
});

describe('вебхук без OW_WEBHOOK_SECRET (push выключен)', () => {
  it('404 даже с «подписью»', async () => {
    const plain = await createDevicesHarness(ow, { OW_WEBHOOK_SECRET: '' });
    try {
      const body = event(alice.aggUserId);
      const response = await plain.app.inject({
        method: 'POST',
        url: '/v1/devices/webhook',
        payload: body,
        headers: svixHeaders(body, plain.clock.now()),
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await plain.close();
    }
  });
});

describe('безопасность ответов и логов (AC13)', () => {
  it('ответы без aggUserId, aggWorkoutId, тикетов, координат; логи без ключа OW, тикета, authorizeUrl и тела вебхука', async () => {
    const logged: unknown[][] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
    const bodies: string[] = [];
    const record = (response: { body: unknown; headers: Record<string, unknown> }) => {
      bodies.push(JSON.stringify(response.body), JSON.stringify(response.headers));
      return response;
    };

    // новый пользователь проходит весь путь: connect → callback → complete → pull → вебхук → sync → отключение
    const bob = await rider(h, 'bob@example.com');
    const started = record(await connect(h, bob));
    const aggUserId = await aggUserIdOf(h, bob.userId);
    const ticket = ticketFromOw(ow, aggUserId);
    const authorizeUrl = (started.body as { authorizeUrl: string }).authorizeUrl;
    ow.authorize(aggUserId, 'garmin');
    const callback = await h.app.inject({ method: 'GET', url: `/v1/devices/callback?t=${ticket}` });
    expect(callback.statusCode).toBe(302);
    record(await complete(h, bob, ticket));
    record(await complete(h, bob, ticket));
    await runOutbox(h, 'devices.connected');

    const start = new Date(h.clock.now().getTime() - 5 * 3_600_000);
    const points = rideTrack(start, 50);
    // дробный пульс: целое «151» случайно встречалось в UUID ответов (state в authorizeUrl) — флак проверки ниже
    const avgHeartRate = 151.379;
    const workout = ow.addWorkout(aggUserId, {
      start_time: start.toISOString(),
      duration_seconds: 50,
      avg_heart_rate_bpm: avgHeartRate,
    });
    ow.addTrack(aggUserId, 'garmin', points);
    const connection = await devices(h).connections.findOne({ userId: bob.userId });
    await syncService(h).pull(connection?._id ?? '');

    const body = event(aggUserId, 'webhook-body-marker');
    await send(body, svixHeaders(body, h.clock.now()));
    await send(body, svixHeaders(`${body}x`, h.clock.now()));
    record(await listDevices(h, bob));
    record(await syncNow(h, bob));
    record(await syncNow(h, bob));
    record(await call(h, 'GET', '/v1/tracks/uploads', undefined, bob.auth));
    record(
      await call(h, 'POST', '/v1/devices/garmin/disconnect', { deleteActivities: false }, bob.auth),
    );

    const responses = bodies.join('\n');
    for (const secret of [
      aggUserId,
      alice.aggUserId,
      workout.id,
      ticket,
      String(points[0]?.[1]),
      String(avgHeartRate),
    ]) {
      expect(responses).not.toContain(secret);
    }
    const logs = JSON.stringify(logged);
    expect(logged.length).toBeGreaterThan(0);
    for (const secret of [
      FAKE_OW_API_KEY,
      ticket,
      authorizeUrl,
      aggUserId,
      'webhook-body-marker',
      WEBHOOK_SECRET,
      String(points[0]?.[1]),
      'bob@example.com',
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});
