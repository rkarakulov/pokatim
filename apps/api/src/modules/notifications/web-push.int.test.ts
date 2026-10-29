import { createECDH } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { NotificationSettings, WebPushConfig } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FakeWebPush, startFakeWebPush } from '../../../test/fake-web-push';
import { createHarness, type Harness } from '../../../test/harness';
import { bearer, call, collections } from '../../../test/identity';
import {
  NOTIFICATIONS,
  notificationsDb,
  runIntake,
  runPush,
  seedNotification,
  seedPushToken,
  eventsOfType,
} from '../../../test/notifications';
import { authed, createRide, join, RIDES, rider, type Rider } from '../../../test/rides';
import { RIDES_RIDE_CANCELLED } from '../rides';
import type { NotificationDoc } from './notifications.collection';
import { NOTIFICATIONS_POLICY } from './notifications.policy';

/**
 * Web Push (ADR-0022): подписки браузера — HTTP `/v1/notifications/web-push*` и доставка тем же `notifications.push`
 * через фейковый push-сервис (тело расшифровывается ключом подписки). Expo на стенде выключен (`PUSH_ENABLED=false`):
 * Web Push — независимый транспорт. Стенд: 2026-10-22 09:00Z = 12:00 по Минску (вне тихих часов).
 */
function vapid() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'),
    VAPID_PRIVATE_KEY: Buffer.from(
      ecdh.getPrivateKey().toString('hex').padStart(64, '0'),
      'hex',
    ).toString('base64url'),
  };
}

const FCM = 'https://fcm.googleapis.com/fcm/send/';
const KEYS = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };
const WEB = `${NOTIFICATIONS}/web-push`;
const SUBSCRIPTIONS = `${WEB}/subscriptions`;

let push: FakeWebPush;
let h: Harness;
let a: Rider;
let b: Rider;
const keys = vapid();
beforeAll(async () => {
  push = await startFakeWebPush();
  h = await createHarness({
    WEB_PUSH_ENABLED: 'true',
    ...keys,
    VAPID_SUBJECT: 'mailto:dev@pokatim.test',
    WEB_PUSH_TEST_ORIGIN: push.origin,
  });
});
beforeEach(async () => {
  await h.reset();
  push.reset();
  a = await rider(h, 'a@example.by');
  b = await rider(h, 'b@example.by');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await push.stop();
});

const as = (who: Rider, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  call(h, method, url, payload, bearer(who.token));
const tokens = () => notificationsDb(h).pushTokens.find({}).sort({ _id: 1 }).toArray();

describe('HTTP подписок', () => {
  it.each([
    ['GET', WEB],
    ['PUT', SUBSCRIPTIONS],
    ['POST', `${SUBSCRIPTIONS}/revoke`],
  ] as const)('%s %s без сессии — 401', async (method, url) => {
    expect((await call(h, method, url, {})).status).toBe(401);
  });

  it('конфиг — публичный ключ VAPID, no-store; приватного нет', async () => {
    const res = await as(a, 'GET', WEB);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(WebPushConfig.parse(res.body)).toEqual({ publicKey: keys.VAPID_PUBLIC_KEY });
    expect(JSON.stringify(res.body)).not.toContain(keys.VAPID_PRIVATE_KEY);
  });

  it('подписка — 204, документ web с ключами под сессией запроса; повтор обновляет ключи без второго документа', async () => {
    const endpoint = `${FCM}a1`;
    expect((await as(a, 'PUT', SUBSCRIPTIONS, { endpoint, keys: KEYS })).status).toBe(204);
    const session = await collections(h).sessions.findOne({ userId: a.userId });
    const [doc] = await tokens();
    expect(doc).toMatchObject({
      token: endpoint,
      userId: a.userId,
      sessionId: session!._id,
      platform: 'web',
      webPush: KEYS,
    });
    const renewed = { p256dh: `B${'Q'.repeat(86)}`, auth: 'Q'.repeat(22) };
    expect((await as(a, 'PUT', SUBSCRIPTIONS, { endpoint, keys: renewed })).status).toBe(204);
    expect((await tokens()).map((token) => token.webPush)).toEqual([renewed]);
  });

  it('тот же endpoint другим аккаунтом — переходит к нему (браузер один), у прежнего — нет', async () => {
    const endpoint = `${FCM}shared`;
    await as(a, 'PUT', SUBSCRIPTIONS, { endpoint, keys: KEYS });
    await as(b, 'PUT', SUBSCRIPTIONS, { endpoint, keys: KEYS });
    expect((await tokens()).map((token) => token.userId)).toEqual([b.userId]);
  });

  it('несколько подписок на пользователя; снятие своей — удалена, чужой и неизвестной — 204 без эффекта', async () => {
    await as(a, 'PUT', SUBSCRIPTIONS, { endpoint: `${FCM}a1`, keys: KEYS });
    await as(a, 'PUT', SUBSCRIPTIONS, { endpoint: `${FCM}a2`, keys: KEYS });
    await as(b, 'PUT', SUBSCRIPTIONS, { endpoint: `${FCM}b1`, keys: KEYS });
    expect((await as(b, 'POST', `${SUBSCRIPTIONS}/revoke`, { endpoint: `${FCM}a1` })).status).toBe(
      204,
    );
    expect(
      (await as(a, 'POST', `${SUBSCRIPTIONS}/revoke`, { endpoint: `${FCM}unknown` })).status,
    ).toBe(204);
    expect((await tokens()).map((token) => token.token).sort()).toEqual(
      [`${FCM}a1`, `${FCM}a2`, `${FCM}b1`].sort(),
    );
    expect((await as(a, 'POST', `${SUBSCRIPTIONS}/revoke`, { endpoint: `${FCM}a1` })).status).toBe(
      204,
    );
    expect((await tokens()).map((token) => token.token).sort()).toEqual(
      [`${FCM}a2`, `${FCM}b1`].sort(),
    );
  });

  it('endpoint вне push-сервисов (SSRF), http, лишние ключи, userId в теле — 400', async () => {
    for (const body of [
      { endpoint: 'https://169.254.169.254/latest', keys: KEYS },
      { endpoint: `${push.origin}/sub/x`, keys: KEYS },
      { endpoint: 'http://fcm.googleapis.com/fcm/send/x', keys: KEYS },
      { endpoint: `${FCM}x`, keys: KEYS, userId: b.userId },
      { endpoint: `${FCM}x`, keys: { ...KEYS, auth: 'short' } },
    ]) {
      const res = await as(a, 'PUT', SUBSCRIPTIONS, body);
      expect(res.status).toBe(400);
    }
    expect(await tokens()).toEqual([]);
  });

  it('лимит notifications-push-token общий с токенами Expo: сверх — 429', async () => {
    const { limit } = NOTIFICATIONS_POLICY.pushTokenLimit;
    for (let i = 0; i < limit; i += 1) {
      expect(
        (await as(a, 'PUT', SUBSCRIPTIONS, { endpoint: `${FCM}n${i % 3}`, keys: KEYS })).status,
      ).toBe(204);
    }
    const res = await as(a, 'POST', `${SUBSCRIPTIONS}/revoke`, { endpoint: `${FCM}n0` });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

/** Подписка фейкового push-сервиса (вне белого списка — только прямой вставкой) под живой сессией пользователя. */
async function seedWebSubscription(userId: string, name: string, sessionId?: string) {
  const id = await seedPushToken(h, userId, name, sessionId);
  const subscription = push.subscription(name);
  await notificationsDb(h).pushTokens.updateOne(
    { _id: id },
    { $set: { token: subscription.endpoint, platform: 'web', webPush: subscription.keys } },
  );
  return id;
}

const pendingPush = (userId: string, overrides: Partial<NotificationDoc> = {}) =>
  seedNotification(h, userId, {
    push: {
      state: 'pending',
      notBefore: h.clock.now(),
      claimId: null,
      claimedUntil: null,
      sentAt: null,
      reason: null,
    },
    ...overrides,
  });
const pushOf = async (id: string) =>
  (await notificationsDb(h).notifications.findOne({ _id: id }))?.push;

describe('доставка Web Push', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('intake при выключенном Expo: канал push включён Web Push — pending, а не push_off', async () => {
    const organizer = await rider(h, 'org@example.by');
    const ride = await createRide(h, organizer, { title: 'Кофе на море' });
    expect((await join(h, a, ride.id)).status).toBe(200);
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    const [event] = await eventsOfType(h, RIDES_RIDE_CANCELLED);
    await runIntake(h, RIDES_RIDE_CANCELLED, event!._id);
    const [doc] = await notificationsDb(h).notifications.find({ userId: a.userId }).toArray();
    expect(doc?.push).toMatchObject({ state: 'pending', reason: null });
  });

  it('одно уведомление — на каждую подписку пользователя: текст и цель, без userId и e-mail', async () => {
    await seedWebSubscription(a.userId, 'a1');
    await seedWebSubscription(a.userId, 'a2');
    await seedWebSubscription(b.userId, 'b1');
    const doc = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    const expected = { title: doc.title, body: doc.body, target: doc.target };
    expect(push.payloadsOf('a1')).toEqual([expected]);
    expect(push.payloadsOf('a2')).toEqual([expected]);
    expect(push.payloadsOf('b1')).toEqual([]);
    expect(JSON.stringify(push.payloadsOf('a1'))).not.toContain(a.userId);
    expect(await pushOf(doc._id)).toMatchObject({ state: 'sent' });
  });

  it('несколько уведомлений — одна сводка без цели', async () => {
    await seedWebSubscription(a.userId, 'a1');
    await pendingPush(a.userId);
    await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(push.payloadsOf('a1')).toEqual([expect.objectContaining({ target: null })]);
  });

  it('группа выключена в настройках — не шлётся (disabled)', async () => {
    await seedWebSubscription(a.userId, 'a1');
    const settings = NotificationSettings.parse(
      (await as(a, 'GET', `${NOTIFICATIONS}/settings`)).body,
    );
    settings.push.rides = false;
    expect((await as(a, 'PUT', `${NOTIFICATIONS}/settings`, settings)).status).toBe(200);
    const doc = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('skipped');
    expect(push.calls).toHaveLength(0);
    expect(await pushOf(doc._id)).toMatchObject({ state: 'skipped', reason: 'disabled' });
  });

  it('410 и 404 — подписка удаляется сразу; другая подписка получает push', async () => {
    const gone = await seedWebSubscription(a.userId, 'gone');
    const missing = await seedWebSubscription(a.userId, 'missing');
    await seedWebSubscription(a.userId, 'live');
    push.statuses.set('gone', 410);
    push.statuses.set('missing', 404);
    await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    const left = await notificationsDb(h).pushTokens.find({ userId: a.userId }).toArray();
    expect(left.map((token) => token._id)).not.toContain(gone);
    expect(left.map((token) => token._id)).not.toContain(missing);
    expect(left).toHaveLength(1);
  });

  it('единственная подписка 410 — failed, подписки больше нет; следующий push — no_tokens', async () => {
    await seedWebSubscription(a.userId, 'gone');
    push.statuses.set('gone', 410);
    const first = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('failed');
    expect(await pushOf(first._id)).toMatchObject({ state: 'failed' });
    const second = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('skipped');
    expect(await pushOf(second._id)).toMatchObject({ state: 'skipped', reason: 'no_tokens' });
  });

  it('push-сервис недоступен (503) — повтор задачи; последняя попытка — failed', async () => {
    await seedWebSubscription(a.userId, 'a1');
    push.statuses.set('a1', 503);
    const doc = await pendingPush(a.userId);
    await expect(runPush(h, a.userId)).rejects.toThrow();
    expect(await pushOf(doc._id)).toMatchObject({ state: 'pending', limitCharged: true });
    await expect(runPush(h, a.userId, 4)).rejects.toThrow();
    expect(await pushOf(doc._id)).toMatchObject({ state: 'failed', reason: 'unavailable' });
  });

  it('подписка отозванной сессии (выход) — снимается при доставке, push не уходит', async () => {
    const id = await seedWebSubscription(a.userId, 'a1');
    await collections(h).sessions.updateMany(
      { userId: a.userId },
      { $set: { revokedAt: h.clock.now(), revokedReason: 'signed_out' } },
    );
    await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('skipped');
    expect(push.calls).toHaveLength(0);
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: id })).toBe(0);
  });

  it('токен Expo при выключенном Expo не трогается и не считается: только web', async () => {
    const expo = await seedPushToken(h, a.userId, 'expo1');
    await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('skipped');
    await seedWebSubscription(a.userId, 'a1');
    await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(push.payloadsOf('a1')).toHaveLength(1);
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: expo })).toBe(1);
  });
});
