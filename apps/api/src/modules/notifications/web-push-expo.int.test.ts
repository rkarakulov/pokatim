import { createECDH } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FakeExpo, startFakeExpo } from '../../../test/fake-expo';
import { type FakeWebPush, startFakeWebPush } from '../../../test/fake-web-push';
import { createHarness, type Harness } from '../../../test/harness';
import {
  expoToken,
  notificationsDb,
  runPush,
  seedNotification,
  seedPushToken,
} from '../../../test/notifications';
import { rider, type Rider } from '../../../test/rides';
import type { NotificationDoc } from './notifications.collection';

/**
 * Оба транспорта включены (ADR-0021): Expo (фейковый Expo Push API) и Web Push (фейковый push-сервис) в одной задаче
 * `notifications.push`. Сбой одного не мешает другому; ретрай — только если не принял никто (дублей нет).
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

let expo: FakeExpo;
let push: FakeWebPush;
let h: Harness;
let a: Rider;
beforeAll(async () => {
  expo = await startFakeExpo();
  push = await startFakeWebPush();
  h = await createHarness({
    PUSH_ENABLED: 'true',
    EXPO_PUSH_API_URL: expo.url,
    WEB_PUSH_ENABLED: 'true',
    ...vapid(),
    VAPID_SUBJECT: 'mailto:dev@pokatim.test',
    WEB_PUSH_TEST_ORIGIN: push.origin,
  });
});
beforeEach(async () => {
  await h.reset();
  expo.reset();
  push.reset();
  a = await rider(h, 'a@example.by');
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
  await expo.stop();
  await push.stop();
});

async function seedWeb(userId: string, name: string) {
  const id = await seedPushToken(h, userId, name);
  const subscription = push.subscription(name);
  await notificationsDb(h).pushTokens.updateOne(
    { _id: id },
    { $set: { token: subscription.endpoint, platform: 'web', webPush: subscription.keys } },
  );
  return id;
}
const pendingPush = (userId: string) =>
  seedNotification(h, userId, {
    push: {
      state: 'pending',
      notBefore: h.clock.now(),
      claimId: null,
      claimedUntil: null,
      sentAt: null,
      reason: null,
    } satisfies NotificationDoc['push'],
  });
const pushOf = async (id: string) =>
  (await notificationsDb(h).notifications.findOne({ _id: id }))?.push;
const tickets = () => notificationsDb(h).pushTickets.countDocuments({ userId: a.userId });

describe('Expo и Web Push вместе', () => {
  it('оба приняли — одно и то же уведомление на телефон и в браузер; тикет — только Expo', async () => {
    await seedPushToken(h, a.userId, 'phone');
    await seedWeb(a.userId, 'pc');
    const doc = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(expo.callsTo('send')).toHaveLength(1);
    expect(push.payloadsOf('pc')).toEqual([
      { title: doc.title, body: doc.body, target: doc.target },
    ]);
    expect(await tickets()).toBe(1);
  });

  it('Expo недоступен (503), браузер принял — sent без ретрая (повтор не продублирует web)', async () => {
    await seedPushToken(h, a.userId, 'phone');
    await seedWeb(a.userId, 'pc');
    expo.fail('send', 503, 10);
    const doc = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(push.payloadsOf('pc')).toHaveLength(1);
    expect(await pushOf(doc._id)).toMatchObject({ state: 'sent' });
  });

  it('Expo принял, push-сервис браузера 503 — sent без ретрая', async () => {
    await seedPushToken(h, a.userId, 'phone');
    await seedWeb(a.userId, 'pc');
    push.statuses.set('pc', 503);
    const doc = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('sent');
    expect(await pushOf(doc._id)).toMatchObject({ state: 'sent' });
  });

  it('оба недоступны — ретрай с уже списанным лимитом; повтор, когда сервисы ожили, — sent', async () => {
    await seedPushToken(h, a.userId, 'phone');
    await seedWeb(a.userId, 'pc');
    expo.fail('send', 503, 1);
    push.statuses.set('pc', 503);
    const doc = await pendingPush(a.userId);
    await expect(runPush(h, a.userId)).rejects.toThrow();
    expect(await pushOf(doc._id)).toMatchObject({ state: 'pending', limitCharged: true });
    push.statuses.delete('pc');
    expect(await runPush(h, a.userId, 1)).toBe('sent');
    // два запроса к push-сервису: первый получил 503, второй принят
    expect(push.calls.map((call) => call.path)).toEqual(['/sub/pc', '/sub/pc']);
    expect(expo.callsTo('send')).toHaveLength(2);
  });

  it('DeviceNotRegistered и 410 в одном прогоне — оба токена сняты, тикетов нет, failed', async () => {
    const phone = await seedPushToken(h, a.userId, 'phone');
    const pc = await seedWeb(a.userId, 'pc');
    expo.unregistered.add(expoToken('phone'));
    push.statuses.set('pc', 410);
    const doc = await pendingPush(a.userId);
    expect(await runPush(h, a.userId)).toBe('failed');
    expect(await notificationsDb(h).pushTokens.countDocuments({ _id: { $in: [phone, pc] } })).toBe(
      0,
    );
    expect(await tickets()).toBe(0);
    expect(await pushOf(doc._id)).toMatchObject({ state: 'failed' });
  });
});
