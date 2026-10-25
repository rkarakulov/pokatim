import { type CookieSerializeOptions, Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  type AnySession,
  type CookieSession,
  type Session,
  SESSION_COOKIE,
  type SessionTransport,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

/**
 * Атрибуты cookie refresh — один источник для установки и сброса: браузер заменяет cookie только при тех же
 * `Path`/`Domain`, а `__Secure-` — только с `Secure`. Без `Domain` (host-only); путь — эндпоинты сессии.
 */
const ATTRIBUTES = {
  path: SESSION_COOKIE.path,
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
} as const satisfies CookieSerializeOptions;

/**
 * Доставка сессии по транспорту клиента (R5 F5b): `body` (native) — `Session` в теле как есть; `cookie` (web) —
 * refresh только в httpOnly cookie `SESSION_COOKIE`, в теле `CookieSession`. `reply` — объект ответа платформы
 * (`@Res({ passthrough: true })`); заголовки пишет HTTP-адаптер Nest.
 */
@Injectable()
export class SessionCookie {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  deliver(reply: unknown, session: Session, transport: SessionTransport): AnySession {
    if (transport === 'body') return session;
    const { refreshToken, ...cookieSession } = session;
    const remainingMs = Date.parse(session.refreshTokenExpiresAt) - this.clock.now().getTime();
    this.adapter.setCookie(reply, SESSION_COOKIE.name, refreshToken, {
      ...ATTRIBUTES,
      // остаток срока сессии (скользящий, не дальше абсолютного предела — ADR-0005)
      maxAge: Math.max(0, Math.floor(remainingMs / 1000)),
    });
    return cookieSession satisfies CookieSession;
  }

  clear(reply: unknown): void {
    this.adapter.clearCookie(reply, SESSION_COOKIE.name, ATTRIBUTES);
  }

  /** Ответы с токенами не кешируются — ставится до работы обработчика, чтобы попасть и в ответ-ошибку. */
  noStore(reply: unknown): void {
    this.adapter.setHeader(reply, 'Cache-Control', 'no-store');
  }

  private get adapter() {
    return this.adapterHost.httpAdapter;
  }
}
