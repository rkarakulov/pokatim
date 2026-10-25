import { createHmac, timingSafeEqual } from 'node:crypto';

import { WebhookSignatureError } from './wearables-aggregator';

/** Окно метки времени Svix (защита от повтора): ±5 минут от часов сервера. */
export const SVIX_TOLERANCE_SEC = 5 * 60;

const header = (headers: Record<string, string | undefined>, name: string) => {
  const value = headers[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null;
};

/**
 * Проверка подписи Svix (исходящие вебхуки Open Wearables): HMAC-SHA256 от `<svix-id>.<svix-timestamp>.<сырое тело>`
 * ключом из `whsec_<base64>`; `svix-signature` — список `v1,<base64>` через пробел (ротация ключа), совпадение
 * любой — успех; сравнение — `timingSafeEqual`; метка времени — в окне ±5 мин от `now`. Отказ —
 * `WebhookSignatureError` с причиной без значений заголовков и тела.
 */
export function verifySvixSignature(
  secret: string,
  headers: Record<string, string | undefined>,
  rawBody: Buffer,
  now: Date,
): void {
  const id = header(headers, 'svix-id');
  const timestamp = header(headers, 'svix-timestamp');
  const signatures = header(headers, 'svix-signature');
  if (!id || !timestamp || !signatures) throw new WebhookSignatureError('missing headers');
  if (!/^\d{1,12}$/.test(timestamp)) throw new WebhookSignatureError('invalid timestamp');
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) > SVIX_TOLERANCE_SEC) {
    throw new WebhookSignatureError('timestamp outside tolerance');
  }

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (key.length === 0) throw new WebhookSignatureError('invalid secret');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(rawBody).digest();

  const matched = signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',', 2);
    if (version !== 'v1' || !value) return false;
    const candidate = Buffer.from(value, 'base64');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!matched) throw new WebhookSignatureError('signature mismatch');
}
