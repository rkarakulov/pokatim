import { createECDH } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FakeWebPush, startFakeWebPush } from '../../../test/fake-web-push';
import { WEB_PUSH_MAX_PLAINTEXT } from './web-push.crypto';
import { encodePayload, HttpWebPushSender, type WebPushPayload } from './web-push.sender';

const RIDE = '0190a8c8-0000-7000-8000-000000000001';
const NOW = new Date('2026-10-29T09:00:00Z');

function vapid() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: Buffer.from(ecdh.getPrivateKey().toString('hex').padStart(64, '0'), 'hex').toString(
      'base64url',
    ),
    subject: 'mailto:dev@pokatim.test',
  };
}

let push: FakeWebPush;
const keys = vapid();
beforeAll(async () => {
  push = await startFakeWebPush();
});
afterAll(async () => {
  await push.stop();
});
beforeEach(() => {
  push.reset();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

const make = (overrides: { timeoutMs?: number; testOrigin?: string | null } = {}) =>
  new HttpWebPushSender({ vapid: keys, testOrigin: push.origin, now: () => NOW, ...overrides });

const payload: WebPushPayload = {
  title: 'Райд отменён',
  body: '«Кофе» отменён.',
  target: { type: 'ride', rideId: RIDE },
};

describe('HttpWebPushSender', () => {
  it('POST на endpoint: тело aes128gcm расшифровывается ключом подписки; VAPID, TTL, Urgency', async () => {
    const subscription = push.subscription('a');
    await expect(
      make().send({ endpoint: subscription.endpoint, ...subscription.keys }, payload),
    ).resolves.toEqual({ status: 'ok' });
    expect(push.payloadsOf('a')).toEqual([payload]);
    const [call] = push.calls;
    expect(call?.headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '86400',
      urgency: 'normal',
    });
    const auth = /^vapid t=([^,]+), k=(\S+)$/.exec(String(call?.headers.authorization));
    expect(auth?.[2]).toBe(keys.publicKey);
    expect(decodeJwt(auth![1]!)).toMatchObject({ aud: push.origin, sub: keys.subject });
  });

  it('длинные тексты обрезаются до лимита тела', async () => {
    const subscription = push.subscription('a');
    const long = { ...payload, title: 'я'.repeat(500), body: 'ю'.repeat(5000) };
    await expect(
      make().send({ endpoint: subscription.endpoint, ...subscription.keys }, long),
    ).resolves.toEqual({
      status: 'ok',
    });
    const [sent] = push.payloadsOf('a') as WebPushPayload[];
    expect(sent?.title).toHaveLength(150);
    expect(sent?.body).toHaveLength(900);
    expect(sent?.body.endsWith('…')).toBe(true);
  });

  it.each([
    [404, { status: 'gone' }],
    [410, { status: 'gone' }],
    [429, { status: 'error', kind: 'unavailable', code: 'http_429' }],
    [503, { status: 'error', kind: 'unavailable', code: 'http_503' }],
    [413, { status: 'error', kind: 'rejected', code: 'http_413' }],
    [403, { status: 'error', kind: 'rejected', code: 'http_403' }],
    [301, { status: 'error', kind: 'protocol', code: 'http_301' }],
  ])('ответ %i — %o', async (status, expected) => {
    const subscription = push.subscription('a');
    push.statuses.set('a', status);
    await expect(
      make().send({ endpoint: subscription.endpoint, ...subscription.keys }, payload),
    ).resolves.toEqual(expected);
  });

  it('endpoint вне белого списка — без запроса', async () => {
    const subscription = push.subscription('a');
    await expect(
      make({ testOrigin: null }).send(
        { endpoint: subscription.endpoint, ...subscription.keys },
        payload,
      ),
    ).resolves.toEqual({ status: 'error', kind: 'rejected', code: 'endpoint_not_allowed' });
    expect(push.calls).toHaveLength(0);
  });

  it('сеть недоступна — unavailable, endpoint в лог не попадает', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const dead = await startFakeWebPush();
    const subscription = dead.subscription('x');
    await dead.stop();
    const result = await new HttpWebPushSender({ vapid: keys, testOrigin: dead.origin }).send(
      { endpoint: subscription.endpoint, ...subscription.keys },
      payload,
    );
    expect(result).toEqual({ status: 'error', kind: 'unavailable', code: 'network' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/sub/x');
  });

  it('экранирование JSON раздувает байты — текст укорачивается до лимита тела', () => {
    const escaped = { ...payload, title: '\u0001'.repeat(150), body: '\u0001'.repeat(900) };
    const bytes = encodePayload(escaped);
    expect(bytes.length).toBeLessThanOrEqual(WEB_PUSH_MAX_PLAINTEXT);
    const decoded = JSON.parse(bytes.toString('utf8')) as WebPushPayload;
    expect(decoded.title).toHaveLength(150);
    expect(decoded.target).toEqual(payload.target);
  });

  it('битые ключи подписки (не точка P-256) — gone без запроса: подписка непригодна', async () => {
    const subscription = push.subscription('a');
    await expect(
      make().send(
        { endpoint: subscription.endpoint, p256dh: 'AAAA', auth: subscription.keys.auth },
        payload,
      ),
    ).resolves.toEqual({ status: 'gone' });
    expect(push.calls).toHaveLength(0);
  });
});
