import { createECDH, createPublicKey } from 'node:crypto';

import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { decryptWebPush, webPushSubscriber } from '../../../test/fake-web-push';
import { encryptWebPush, VapidSigner, WEB_PUSH_MAX_PLAINTEXT } from './web-push.crypto';

const b64 = (value: string) => Buffer.from(value, 'base64url');

describe('encryptWebPush (RFC 8291)', () => {
  it('вектор RFC 8291 Appendix A — байт в байт', () => {
    const body = encryptWebPush(
      b64('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg', // gitleaks:allow — публичный вектор RFC 8291 Appendix A
      },
      {
        ephemeralPrivateKey: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
        salt: b64('DGv6ra1nlYgDCS1FRnbzlw'),
      },
    );
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('браузер расшифровывает своим ключом; эфемерный ключ и соль — новые на каждое сообщение', () => {
    const subscriber = webPushSubscriber();
    const text = Buffer.from(JSON.stringify({ title: 'Райд отменён', body: '«Кофе» отменён.' }));
    const first = encryptWebPush(text, subscriber.keys);
    const second = encryptWebPush(text, subscriber.keys);
    expect(decryptWebPush(first, subscriber).toString()).toBe(text.toString());
    expect(first.subarray(0, 16).equals(second.subarray(0, 16))).toBe(false);
    expect(first.length).toBeLessThanOrEqual(4096);
  });

  it('тело больше лимита push-сервиса — отказ', () => {
    const subscriber = webPushSubscriber();
    const max = Buffer.alloc(WEB_PUSH_MAX_PLAINTEXT, 'x');
    expect(encryptWebPush(max, subscriber.keys)).toHaveLength(4096);
    expect(() => encryptWebPush(Buffer.alloc(WEB_PUSH_MAX_PLAINTEXT + 1), subscriber.keys)).toThrow(
      RangeError,
    );
  });
});

describe('VapidSigner (RFC 8292)', () => {
  it('JWT ES256: aud — origin push-сервиса, exp ≤ 24 ч, sub; k — публичный ключ; подпись — ключом сервера', async () => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const publicKey = ecdh.getPublicKey().toString('base64url');
    const privateKey = Buffer.from(ecdh.getPrivateKey().toString('hex').padStart(64, '0'), 'hex');
    const signer = new VapidSigner({
      publicKey,
      privateKey: privateKey.toString('base64url'),
      subject: 'mailto:dev@pokatim.test',
    });
    const now = new Date('2026-10-29T09:00:00Z');
    const header = await signer.authorization('https://fcm.googleapis.com', now);
    const match = /^vapid t=([^,]+), k=(\S+)$/.exec(header);
    expect(match?.[2]).toBe(publicKey);
    const jwt = match![1]!;
    expect(decodeProtectedHeader(jwt)).toEqual({ typ: 'JWT', alg: 'ES256' });
    const point = b64(publicKey);
    const verifyKey = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
    });
    const { payload } = await jwtVerify(jwt, verifyKey, { currentDate: now });
    expect(payload).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now.getTime() / 1000 + 12 * 3600,
      sub: 'mailto:dev@pokatim.test',
    });
  });
});
