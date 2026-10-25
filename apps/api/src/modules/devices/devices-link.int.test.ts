import { DeviceList } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  aggUserIdOf,
  complete,
  connect,
  connectActive,
  createDevicesHarness,
  devices,
  disconnect,
  jobOf,
  listDevices,
  NATIVE_RETURN_URL,
  pendingPulls,
  PUBLIC_API_ORIGIN,
  type Rider,
  rider,
  runOutbox,
  ticketFromOw,
  WEB_RETURN_URL,
} from '../../../test/devices';
import { type FakeOw, startFakeOw } from '../../../test/fake-ow';
import { type Harness, MINUTE } from '../../../test/harness';
import { call, gate, outboxEvents } from '../../../test/identity';
import { DevicesLocks } from './devices-jobs';
import { DevicesLinkService } from './devices-link.service';
import { DevicesMaintenanceProcessor } from './devices-maintenance.processor';

let ow: FakeOw;
let h: Harness;
let alice: Rider;

beforeAll(async () => {
  ow = await startFakeOw();
  h = await createDevicesHarness(ow);
});
beforeEach(async () => {
  await h.reset();
  ow.reset();
  alice = await rider(h);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await ow.stop();
});

const items = (body: unknown) => DeviceList.parse(body).items;
const garminOf = (body: unknown) => items(body).find((item) => item.provider === 'garmin');

describe('GET /v1/devices (AC6)', () => {
  it('провайдеры — живой каталог OW ∩ allowlist: garmin, wahoo; strava из OW не показан; no-store', async () => {
    const response = await listDevices(h, alice);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(items(response.body)).toEqual([
      {
        provider: 'garmin',
        name: 'Garmin',
        available: true,
        status: 'not_connected',
        issue: null,
        connectedAt: null,
        lastSyncedAt: null,
      },
      {
        provider: 'wahoo',
        name: 'Wahoo',
        available: true,
        status: 'not_connected',
        issue: null,
        connectedAt: null,
        lastSyncedAt: null,
      },
    ]);
  });

  it('выключенный в OW провайдер — available: false; каталог кешируется (второй запрос без вызова OW)', async () => {
    ow.providers = ow.providers.map((row) =>
      row.provider === 'wahoo' ? { ...row, is_enabled: false } : row,
    );
    const first = await listDevices(h, alice);
    expect(items(first.body).map((item) => [item.provider, item.available])).toEqual([
      ['garmin', true],
      ['wahoo', false],
    ]);
    await listDevices(h, alice);
    expect(ow.callsTo('GET /oauth/providers')).toHaveLength(1);
  });

  it('OW недоступен — 200, все провайдеры available: false; connect — 409 DEVICE_PROVIDER_UNAVAILABLE', async () => {
    ow.fail('GET /oauth/providers', 503, 5);
    const response = await listDevices(h, alice);
    expect(response.status).toBe(200);
    expect(items(response.body).every((item) => !item.available)).toBe(true);
    const connected = await connect(h, alice);
    expect([connected.status, (connected.body as { code: string }).code]).toEqual([
      409,
      'DEVICE_PROVIDER_UNAVAILABLE',
    ]);
  });

  it('без входа — 401', async () => {
    expect((await call(h, 'GET', '/v1/devices')).status).toBe(401);
  });
});

describe('connect → callback → complete (AC7)', () => {
  it('connect: пользователь OW с external_user_id = pokatim:<id> без ПДн; authorizeUrl — из OW; redirect_uri с тикетом', async () => {
    const response = await connect(h, alice);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      authorizeUrl: expect.stringMatching(/^https:\/\/connect\.provider\.test\//),
    });

    const [created] = ow.callsTo('POST /users');
    expect(created?.body).toEqual({ external_user_id: `pokatim:${alice.userId}` });
    const aggUserId = await aggUserIdOf(h, alice.userId);
    const redirect = new URL(ow.redirectUris.get(aggUserId) ?? '');
    expect(`${redirect.origin}${redirect.pathname}`).toBe(
      `${PUBLIC_API_ORIGIN}/v1/devices/callback`,
    );
    expect(redirect.searchParams.get('t')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const connection = await devices(h).connections.findOne({ userId: alice.userId });
    expect(connection).toMatchObject({ status: 'pending', provider: 'garmin', aggUserId });
    const ticket = await devices(h).tickets.findOne({ connectionId: connection?._id });
    expect(ticket?._id).not.toBe(redirect.searchParams.get('t'));
    expect(garminOf((await listDevices(h, alice)).body)?.status).toBe('pending');
  });

  it('повторный connect — тот же пользователь OW и то же подключение', async () => {
    await connect(h, alice);
    await connect(h, alice, 'garmin', NATIVE_RETURN_URL);
    expect(ow.users.size).toBe(1);
    expect(ow.callsTo('POST /users')).toHaveLength(1);
    expect(await devices(h).connections.countDocuments({ userId: alice.userId })).toBe(1);
  });

  it('returnUrl вне allowlist — 400, в OW ничего не создано', async () => {
    for (const returnUrl of [
      'https://evil.test/devices/return',
      `${WEB_RETURN_URL}.evil.test`,
      'exp://x',
    ]) {
      expect((await connect(h, alice, 'garmin', returnUrl)).status).toBe(400);
    }
    expect(ow.calls.filter((item) => item.route !== 'GET /oauth/providers')).toHaveLength(0);
  });

  it('провайдер вне enum — 400; лимит connect 10/ч — 429', async () => {
    expect((await connect(h, alice, 'strava')).status).toBe(400);
    for (let i = 0; i < 10; i += 1) expect((await connect(h, alice)).status).toBe(200);
    const limited = await connect(h, alice);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
  });

  it('callback: 302 на returnUrl тикета с provider, result=pending, t; повторный заход — тот же; no-referrer, no-store', async () => {
    await connect(h, alice, 'garmin', NATIVE_RETURN_URL);
    const ticket = ticketFromOw(ow, await aggUserIdOf(h, alice.userId));
    for (let i = 0; i < 2; i += 1) {
      const response = await h.app.inject({
        method: 'GET',
        url: `/v1/devices/callback?t=${ticket}`,
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(
        `${NATIVE_RETURN_URL}?provider=garmin&result=pending&t=${ticket}`,
      );
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await devices(h).tickets.countDocuments()).toBe(1);
  });

  it('callback с неизвестным, мусорным или истёкшим тикетом — 302 на web по умолчанию с result=error', async () => {
    await connect(h, alice);
    const ticket = ticketFromOw(ow, await aggUserIdOf(h, alice.userId));
    const expired = async () => {
      h.clock.advance(31 * MINUTE);
      return ticket;
    };
    for (const t of ['A'.repeat(43), '%24ne', await expired()]) {
      const response = await h.app.inject({ method: 'GET', url: `/v1/devices/callback?t=${t}` });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(`${WEB_RETURN_URL}?result=error`);
    }
  });

  it('complete владельцем при подключении в OW → active, журнал, outbox devices.connected → история 30 дней и pull', async () => {
    const connected = await connectActive(h, ow, alice);
    const connection = await devices(h).connections.findOne({ _id: connected.connectionId });
    expect(connection).toMatchObject({
      status: 'active',
      issue: null,
      connectedAt: h.clock.now(),
      catchUpUntil: new Date(h.clock.now().getTime() + 48 * 60 * MINUTE),
    });
    expect(
      await devices(h)
        .audit.find({}, { projection: { _id: 0, at: 0 } })
        .toArray(),
    ).toEqual([
      {
        userId: alice.userId,
        provider: 'garmin',
        connectionId: connected.connectionId,
        action: 'connected',
        reason: null,
      },
    ]);
    expect(await devices(h).tickets.countDocuments()).toBe(0);

    expect(await runOutbox(h, 'devices.connected')).toEqual(['scheduled']);
    const [historical] = ow.callsTo('POST /providers/garmin/users/{id}/sync/historical');
    expect(historical?.query.get('days')).toBe('30');
    expect((await pendingPulls(h)).map((job) => job.data)).toEqual([
      { connectionId: connected.connectionId },
    ]);
    expect(garminOf((await listDevices(h, alice)).body)?.status).toBe('active');
  });

  it('complete без подключения в OW (пользователь отменил) — DEVICE_LINK_INVALID, pending остаётся', async () => {
    await connect(h, alice);
    const ticket = ticketFromOw(ow, await aggUserIdOf(h, alice.userId));
    const response = await complete(h, alice, ticket);
    expect([response.status, (response.body as { code: string }).code]).toEqual([
      400,
      'DEVICE_LINK_INVALID',
    ]);
    expect(await devices(h).connections.findOne({ userId: alice.userId })).toMatchObject({
      status: 'pending',
    });
  });

  it('повтор тикета — DEVICE_LINK_INVALID; два параллельных complete одного тикета — один успех', async () => {
    await connect(h, alice);
    const aggUserId = await aggUserIdOf(h, alice.userId);
    ow.authorize(aggUserId, 'garmin');
    const ticket = ticketFromOw(ow, aggUserId);
    const results = await Promise.all([complete(h, alice, ticket), complete(h, alice, ticket)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    expect((await complete(h, alice, ticket)).body).toMatchObject({ code: 'DEVICE_LINK_INVALID' });
    expect(
      (await outboxEvents(h)).filter((event) => event.type === 'devices.connected'),
    ).toHaveLength(1);
  });

  it('тикет другого провайдера в пути — DEVICE_LINK_INVALID', async () => {
    await connect(h, alice);
    const aggUserId = await aggUserIdOf(h, alice.userId);
    ow.authorize(aggUserId, 'garmin');
    expect((await complete(h, alice, ticketFromOw(ow, aggUserId), 'wahoo')).status).toBe(400);
  });

  it('complete чужим пользователем — DEVICE_LINK_INVALID и отзыв подключения инициатора в OW, импорта нет', async () => {
    const mallory = await rider(h, 'mallory@example.com');
    await connect(h, mallory);
    const aggUserId = await aggUserIdOf(h, mallory.userId);
    // жертва прошла авторизацию по ссылке злоумышленника: OW уже связал её аккаунт провайдера с пользователем OW
    ow.authorize(aggUserId, 'garmin');
    const response = await complete(h, alice, ticketFromOw(ow, aggUserId));
    expect([response.status, (response.body as { code: string }).code]).toEqual([
      400,
      'DEVICE_LINK_INVALID',
    ]);

    const connection = await devices(h).connections.findOne({ userId: mallory.userId });
    expect(connection?.status).toBe('disconnecting');
    expect(await runOutbox(h, 'devices.revoke-requested')).toEqual(['revoked']);
    expect(ow.connections.get(aggUserId)?.get('garmin')).toBe('revoked');
    expect(await devices(h).connections.findOne({ _id: connection?._id })).toMatchObject({
      status: 'revoked',
      revokedReason: 'foreign_ticket',
      revokeFailed: false,
    });
    expect(
      await devices(h)
        .audit.find({}, { projection: { _id: 0, at: 0 } })
        .toArray(),
    ).toEqual([
      {
        userId: mallory.userId,
        provider: 'garmin',
        connectionId: connection?._id,
        action: 'disconnected',
        reason: 'foreign_ticket',
      },
    ]);
    expect(await devices(h).connections.countDocuments({ userId: alice.userId })).toBe(0);
    expect((await outboxEvents(h)).some((event) => event.type === 'devices.connected')).toBe(false);
  });

  it('неподтверждённое за TTL тикета — уборка отзывает в OW → revoked: unconfirmed, журнал', async () => {
    await connect(h, alice);
    const aggUserId = await aggUserIdOf(h, alice.userId);
    ow.authorize(aggUserId, 'garmin');
    const maintenance = h.worker.get(DevicesMaintenanceProcessor);
    expect(await maintenance.process(jobOf('cleanup-pending', {}))).toBe(0);

    h.clock.advance(31 * MINUTE);
    expect(await maintenance.process(jobOf('cleanup-pending', {}))).toBe(1);
    expect(ow.connections.get(aggUserId)?.get('garmin')).toBe('revoked');
    expect(await devices(h).connections.findOne({ userId: alice.userId })).toMatchObject({
      status: 'revoked',
      revokedReason: 'unconfirmed',
    });
    expect((await devices(h).audit.findOne())?.reason).toBe('unconfirmed');
  });

  it('OW недоступен при уборке — подключение ждёт следующего запуска', async () => {
    await connect(h, alice);
    h.clock.advance(31 * MINUTE);
    ow.fail('GET /users/{id}/connections', 503);
    expect(
      await h.worker.get(DevicesMaintenanceProcessor).process(jobOf('cleanup-pending', {})),
    ).toBe(0);
    expect(await devices(h).connections.findOne({ userId: alice.userId })).toMatchObject({
      status: 'pending',
    });
  });

  it('повторный connect при active без проблемы — 409; при reauthorize — тот же документ снова pending', async () => {
    const connected = await connectActive(h, ow, alice);
    expect((await connect(h, alice)).status).toBe(409);
    await devices(h).connections.updateOne(
      { _id: connected.connectionId },
      { $set: { issue: 'reauthorize' } },
    );
    expect((await connect(h, alice)).status).toBe(200);
    expect(await devices(h).connections.findOne({ _id: connected.connectionId })).toMatchObject({
      status: 'pending',
    });
  });
});

describe('ensureUser под замком devices:account:<userId> (гонка 2)', () => {
  /** Два параллельных connect: первый держит создание пользователя в OW на воротах, второй стартует следом. */
  async function race() {
    const createUser = gate();
    ow.hold('POST /users', createUser.wait);
    const first = connect(h, alice);
    await createUser.reached;
    const second = connect(h, alice, 'wahoo');
    // второй либо ждёт замок, либо (без замка) тоже дошёл до OW
    await vi.waitFor(async () => {
      const atOw = ow.callsTo('POST /users').length;
      const waiting = (await h.redis.exists(`devices:account:${alice.userId}`)) === 1;
      if (atOw < 2 && !waiting) throw new Error('второй connect ещё не дошёл до замка');
    });
    createUser.open();
    return Promise.all([first, second]);
  }

  it('два параллельных connect — один пользователь OW, один вызов создания', async () => {
    const [a, b] = await race();
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(ow.callsTo('POST /users')).toHaveLength(1);
    expect(ow.users.size).toBe(1);
    const account = await devices(h).accounts.findOne({ _id: alice.userId });
    expect(ow.users.has(account?.aggUserId ?? '')).toBe(true);
  });

  it('отрицательное доказательство: без замка и без уникальности external_user_id в OW — два пользователя OW', async () => {
    const locks = h.app.get(DevicesLocks);
    vi.spyOn(locks, 'acquire').mockResolvedValue('no-lock');
    vi.spyOn(locks, 'release').mockResolvedValue();
    ow.uniqueExternalId = false;
    await race();
    expect(ow.callsTo('POST /users')).toHaveLength(2);
    expect(ow.users.size).toBe(2);
  });

  it('без замка, но с уникальным external_user_id (OW 0.9) — второй создаёт дубль, получает 400 и находит пользователя', async () => {
    const locks = h.app.get(DevicesLocks);
    vi.spyOn(locks, 'acquire').mockResolvedValue('no-lock');
    vi.spyOn(locks, 'release').mockResolvedValue();
    const [a, b] = await race();
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(ow.callsTo('POST /users')).toHaveLength(2);
    expect(ow.callsTo('GET /users')).toHaveLength(1);
    expect(ow.users.size).toBe(1);
  });

  it('ensureAccount: замок не освобождается дольше ожидания — DEVICE_PROVIDER_ERROR, без вызова OW', async () => {
    vi.spyOn(h.app.get(DevicesLocks), 'acquire').mockResolvedValue(null);
    await expect(h.app.get(DevicesLinkService).ensureAccount(alice.userId)).rejects.toMatchObject({
      code: 'DEVICE_PROVIDER_ERROR',
    });
    expect(ow.callsTo('POST /users')).toHaveLength(0);
  });
});

describe('отключение (AC10)', () => {
  it('disconnecting → revokeConnection в OW → revoked, журнал; заезды без галочки остаются', async () => {
    const connected = await connectActive(h, ow, alice);
    const response = await disconnect(h, alice);
    expect(response.status).toBe(200);
    expect(garminOf(response.body)?.status).toBe('disconnecting');
    expect(await runOutbox(h, 'devices.revoke-requested')).toEqual(['revoked']);
    expect(ow.connections.get(connected.aggUserId)?.get('garmin')).toBe('revoked');
    expect(await devices(h).connections.findOne({ _id: connected.connectionId })).toMatchObject({
      status: 'revoked',
      revokedReason: 'user',
      revokeFailed: false,
      issue: null,
    });
    const actions = (await devices(h).audit.find().sort({ _id: 1 }).toArray()).map((row) => [
      row.action,
      row.reason,
    ]);
    expect(actions).toEqual([
      ['connected', null],
      ['disconnected', 'user'],
    ]);
    expect(garminOf((await listDevices(h, alice)).body)?.status).toBe('not_connected');
    expect((await disconnect(h, alice)).status).toBe(404);
  });

  it('5xx OW — повтор задачи; финальный провал — revoked + revokeFailed, журнал revoke_failed, экран — revoke_failed', async () => {
    await connectActive(h, ow, alice);
    await disconnect(h, alice);
    ow.fail('DELETE /users/{id}/connections/garmin', 503, 5);
    await expect(runOutbox(h, 'devices.revoke-requested', 0)).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect(await runOutbox(h, 'devices.revoke-requested', 4)).toEqual(['revoke_failed']);
    expect(await devices(h).connections.findOne({ userId: alice.userId })).toMatchObject({
      status: 'revoked',
      revokeFailed: true,
      issue: 'revoke_failed',
    });
    expect((await devices(h).audit.find().sort({ _id: -1 }).limit(1).toArray())[0]?.action).toBe(
      'revoke_failed',
    );
    expect(garminOf((await listDevices(h, alice)).body)).toMatchObject({
      status: 'revoked',
      issue: 'revoke_failed',
    });
  });

  it('отключение pending (не дождались complete) и повторная отправка события — без повторного отзыва', async () => {
    await connect(h, alice);
    expect((await disconnect(h, alice)).status).toBe(200);
    expect(await runOutbox(h, 'devices.revoke-requested')).toEqual(['revoked']);
    expect(await runOutbox(h, 'devices.revoke-requested')).toEqual(['skipped']);
    expect(ow.callsTo('DELETE /users/{id}/connections/garmin')).toHaveLength(1);
  });

  it('без подключения — 404; тело не по схеме — 400', async () => {
    expect((await disconnect(h, alice)).status).toBe(404);
    expect(
      (
        await call(
          h,
          'POST',
          '/v1/devices/garmin/disconnect',
          { deleteActivities: 'yes' },
          alice.auth,
        )
      ).status,
    ).toBe(400);
  });
});
