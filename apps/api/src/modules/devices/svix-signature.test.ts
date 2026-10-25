import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySvixSignature } from './svix-signature';
import { WebhookSignatureError } from './wearables-aggregator';

// эталонный пример из документации Svix («Verifying webhooks manually»)
// публичный тестовый вектор Svix, не секрет
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // gitleaks:allow
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const TIMESTAMP = '1614265330';
const BODY = Buffer.from('{"test": 2432232314}');
const SIGNATURE = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
const AT = new Date(Number(TIMESTAMP) * 1000);

const headers = (overrides: Record<string, string | undefined> = {}) => ({
  'svix-id': ID,
  'svix-timestamp': TIMESTAMP,
  'svix-signature': SIGNATURE,
  ...overrides,
});

const rejects = (fn: () => void, reason: string) => {
  expect(fn).toThrow(WebhookSignatureError);
  expect(fn).toThrow(reason);
};

describe('verifySvixSignature', () => {
  it('эталонный вектор Svix — верная подпись', () => {
    expect(() => verifySvixSignature(SECRET, headers(), BODY, AT)).not.toThrow();
  });

  it('несколько подписей через пробел (ротация ключа) — достаточно одной верной', () => {
    const header = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= v2,zzz ${SIGNATURE}`;
    expect(() =>
      verifySvixSignature(SECRET, headers({ 'svix-signature': header }), BODY, AT),
    ).not.toThrow();
  });

  it('подменённое тело — отказ', () => {
    rejects(
      () => verifySvixSignature(SECRET, headers(), Buffer.from('{"test": 2432232315}'), AT),
      'signature mismatch',
    );
  });

  it('другой svix-id — отказ', () => {
    rejects(
      () => verifySvixSignature(SECRET, headers({ 'svix-id': 'msg_other' }), BODY, AT),
      'signature mismatch',
    );
  });

  it('старая или будущая метка вне окна 5 мин — отказ, на границе — принимается', () => {
    rejects(
      () => verifySvixSignature(SECRET, headers(), BODY, new Date(AT.getTime() + 301_000)),
      'timestamp outside tolerance',
    );
    rejects(
      () => verifySvixSignature(SECRET, headers(), BODY, new Date(AT.getTime() - 301_000)),
      'timestamp outside tolerance',
    );
    expect(() =>
      verifySvixSignature(SECRET, headers(), BODY, new Date(AT.getTime() + 300_000)),
    ).not.toThrow();
  });

  it('без префикса whsec_ ключ тот же; другой ключ — отказ', () => {
    expect(() => verifySvixSignature(SECRET.slice(6), headers(), BODY, AT)).not.toThrow();
    rejects(
      () => verifySvixSignature('whsec_AAAAAAAAAAAAAAAAAAAAAAAA', headers(), BODY, AT),
      'signature mismatch',
    );
  });

  it('нет заголовков, нечисловая метка, неизвестная версия подписи — отказ', () => {
    rejects(
      () => verifySvixSignature(SECRET, headers({ 'svix-id': undefined }), BODY, AT),
      'missing headers',
    );
    rejects(
      () => verifySvixSignature(SECRET, headers({ 'svix-timestamp': '16e8' }), BODY, AT),
      'invalid timestamp',
    );
    rejects(
      () =>
        verifySvixSignature(
          SECRET,
          headers({ 'svix-signature': SIGNATURE.replace('v1,', 'v2,') }),
          BODY,
          AT,
        ),
      'signature mismatch',
    );
  });

  it('подпись считается по байтам тела (UTF-8 вне ASCII)', () => {
    const body = Buffer.from('{"name":"Заезд"}');
    const signature = createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64'))
      .update(`${ID}.${TIMESTAMP}.`)
      .update(body)
      .digest('base64');
    expect(() =>
      verifySvixSignature(SECRET, headers({ 'svix-signature': `v1,${signature}` }), body, AT),
    ).not.toThrow();
  });
});
