import { createHmac } from 'node:crypto';

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
