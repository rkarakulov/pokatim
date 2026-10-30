import { createHmac, timingSafeEqual } from 'node:crypto';

import { sha256 } from '../identity';

/**
 * Токен ссылки-приглашения (ADR-0026): `HMAC-SHA256(EMAIL_TOKEN_SECRET, "panel-invitation:" + invitationId)`
 * base64url, 43 символа (`OpaqueToken`). Пересчитывается worker'ом при отправке письма (ретрай — та же ссылка, паттерн
 * ссылок писем ADR-0002); сырого токена нет ни в БД, ни в outbox, ни в логах. Ротация секрета гасит все ссылки.
 */
export function panelInvitationToken(secret: string, invitationId: string): string {
  return createHmac('sha256', secret)
    .update(`panel-invitation:${invitationId}`)
    .digest('base64url');
}

/** Поисковый хеш токена приглашения в БД. */
export const invitationTokenHash = (token: string) => sha256(token);

/**
 * Хеш приглашения выведен из **текущего** секрета (ADR-0026 п. 2): после ротации `EMAIL_TOKEN_SECRET` прежние ссылки
 * не принимаются, а письмо не уходит со ссылкой, которой нет в БД. Сравнение — `timingSafeEqual`.
 */
export function invitationTokenMatches(
  secret: string,
  invitationId: string,
  tokenHash: string,
): boolean {
  const expected = Buffer.from(
    invitationTokenHash(panelInvitationToken(secret, invitationId)),
    'hex',
  );
  const stored = Buffer.from(tokenHash, 'hex');
  return expected.length === stored.length && timingSafeEqual(expected, stored);
}
