import { createHmac } from 'node:crypto';

import { sha256 } from '../identity';

const QR_PREFIX = 'PKT1.';

/**
 * QR-токен билета (ADR-0023): `HMAC-SHA256(EMAIL_TOKEN_SECRET, "ticket-qr:" + ticketId)` base64url, 43 символа. Токен
 * пересчитывается при чтении владельцем (паттерн ссылок писем, ADR-0002); в БД — только `qrHash`. Ротация секрета
 * инвалидирует все QR (runbook «Деплой»).
 */
export function ticketQrToken(secret: string, ticketId: string): string {
  return createHmac('sha256', secret).update(`ticket-qr:${ticketId}`).digest('base64url');
}

/** Содержимое QR: `PKT1.<token>` — без id пользователя и события. */
export const qrPayload = (token: string) => `${QR_PREFIX}${token}`;

/** Токен из содержимого QR (формат уже проверен схемой `TicketQrPayload`); чужой формат — `null`. */
export function parseQrPayload(payload: string): string | null {
  return /^PKT1\.[A-Za-z0-9_-]{43}$/.test(payload) ? payload.slice(QR_PREFIX.length) : null;
}

/** Поисковый хэш QR-токена в БД. */
export const qrHashOf = (token: string) => sha256(token);
