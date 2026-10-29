import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes } from 'node:crypto';

import { SignJWT } from 'jose';

/** Ключи подписки браузера (`PushSubscription.keys`), base64url. */
export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

/** Ключи VAPID сервера (RFC 8292), base64url: публичный — несжатая точка P-256, приватный — 32 байта. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Размер записи aes128gcm (RFC 8188): одна запись на сообщение. */
const RECORD_SIZE = 4096;
/** Тег AES-GCM + разделитель последней записи. */
const RECORD_OVERHEAD = 17;
/** Заголовок тела: salt (16) + rs (4) + idlen (1) + ключ сервера (65). */
const HEADER_SIZE = 86;
/** Push-сервисы принимают тело до 4096 байт: открытый текст — не больше. */
export const WEB_PUSH_MAX_PLAINTEXT = RECORD_SIZE - HEADER_SIZE - RECORD_OVERHEAD;

const fromB64 = (value: string) => Buffer.from(value, 'base64url');
const info = (label: string) => Buffer.from(`Content-Encoding: ${label}\0`, 'ascii');

/**
 * Шифрование payload Web Push (RFC 8291, `Content-Encoding: aes128gcm`): ECDH эфемерного ключа сервера с ключом
 * подписки `p256dh`, секрет `auth` — соль HKDF ключа; одна запись с разделителем `0x02`. `ephemeral`/`salt` — только
 * для теста по вектору RFC 8291 Appendix A, в работе — случайные.
 */
export function encryptWebPush(
  plaintext: Buffer,
  keys: WebPushKeys,
  fixed: { ephemeralPrivateKey?: Buffer; salt?: Buffer } = {},
): Buffer {
  if (plaintext.length > WEB_PUSH_MAX_PLAINTEXT) throw new RangeError('web push payload too large');
  const uaPublic = fromB64(keys.p256dh);
  const authSecret = fromB64(keys.auth);
  const ecdh = createECDH('prime256v1');
  if (fixed.ephemeralPrivateKey) ecdh.setPrivateKey(fixed.ephemeralPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = fixed.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, info('aes128gcm'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, info('nonce'), 12));

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

/** JWT VAPID живёт 12 ч (максимум RFC 8292 — 24 ч). */
const VAPID_TTL_SEC = 12 * 3600;

/**
 * Заголовок `Authorization: vapid t=<JWT ES256>, k=<публичный ключ>` (RFC 8292) для origin push-сервиса. Ключ
 * сервера собирается из пары base64url как JWK P-256.
 */
export class VapidSigner {
  private readonly key: ReturnType<typeof createPrivateKey>;

  constructor(private readonly keys: VapidKeys) {
    const point = fromB64(keys.publicKey);
    this.key = createPrivateKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: keys.privateKey,
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33, 65).toString('base64url'),
      },
    });
  }

  async authorization(audience: string, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ typ: 'JWT', alg: 'ES256' })
      .setAudience(audience)
      .setExpirationTime(iat + VAPID_TTL_SEC)
      .setSubject(this.keys.subject)
      .sign(this.key);
    return `vapid t=${jwt}, k=${this.keys.publicKey}`;
  }
}
