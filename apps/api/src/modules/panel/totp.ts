import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { TOTP_DIGITS, TOTP_ISSUER, TOTP_PERIOD_SEC } from '@pokatim/contracts';

/**
 * TOTP (RFC 6238 поверх HOTP RFC 4226) на `node:crypto`, без зависимостей (ADR-0024, D5): SHA-1, шаг 30 с, 6 цифр,
 * окно ±1 шаг. Повтор закрыт снаружи: код принимается, только если его шаг больше записанного `lastUsedStep`.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Длина секрета — 160 бит (рекомендация RFC 4226 для HMAC-SHA-1). */
const SECRET_BYTES = 20;
/** Окно: принимаются соседние шаги (рассинхрон часов телефона до 30 с в каждую сторону). */
const WINDOW_STEPS = 1;

/** base32 RFC 4648 без паддинга (секрет для ручного ввода и `otpauth://`). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Разбор base32: регистр, пробелы и `=` не важны; чужой символ — ошибка. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('base32: недопустимый символ');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Новый секрет TOTP — 20 случайных байт. */
export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** Номер шага времени (`T` RFC 6238) для момента `now`. */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SEC);
}

/** HOTP(secret, step) — `digits` цифр с ведущими нулями (RFC 4226 §5.3). */
export function generateTotp(secret: Buffer, step: number, digits: number = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Проверка кода: шаги окна `now ± 1`, только больше `lastUsedStep` (повтор и код прошлого шага после принятого —
 * отказ). Сравнение — `timingSafeEqual`, перебираются все шаги окна. Результат — принятый шаг или `null`.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  now: Date,
  lastUsedStep: number | null,
): number | null {
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return null;
  const presented = Buffer.from(code);
  const current = totpStep(now);
  let accepted: number | null = null;
  for (let step = current - WINDOW_STEPS; step <= current + WINDOW_STEPS; step += 1) {
    const match = timingSafeEqual(Buffer.from(generateTotp(secret, step)), presented);
    if (match && accepted === null && (lastUsedStep === null || step > lastUsedStep)) {
      accepted = step;
    }
  }
  return accepted;
}

/**
 * `otpauth://totp/<издатель>:<e-mail>?secret=…&issuer=…&algorithm=SHA1&digits=6&period=30` — для QR приложения-
 * аутентификатора (формат Key Uri, метка и издатель — percent-encoding).
 */
export function otpauthUri(secretBase32: string, email: string): string {
  const issuer = encodeURIComponent(TOTP_ISSUER);
  const label = `${issuer}:${encodeURIComponent(email)}`;
  return (
    `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SEC}`
  );
}
