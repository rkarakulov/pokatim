import { type CookieSerializeOptions, Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { getRequestCookie } from '@nestjs/core/helpers/cookies/request-cookies.js';
import { OpaqueToken, PANEL_SESSION_COOKIE } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

/**
 * Атрибуты cookie панели — один источник для установки и сброса (браузер заменяет cookie только при тех же
 * `Path`/`Domain`, `__Secure-` — только с `Secure`). Без `Domain` (host-only); путь — только API панели.
 */
const ATTRIBUTES = {
  path: PANEL_SESSION_COOKIE.path,
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
} as const satisfies CookieSerializeOptions;

/**
 * Cookie сессии панели (ADR-0009): идентификатор генерирует только сервер при входе (фиксация невозможна),
 * `Max-Age` — остаток абсолютного срока. Разбор — тот же, что у `@Cookies()` Nest.
 */
@Injectable()
export class PanelSessionCookie {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Токен из cookie запроса: мусор и отсутствие — `undefined` (до БД). `presented` — cookie была. */
  read(request: unknown): { token: string | undefined; presented: boolean } {
    const value = getRequestCookie(request as Record<string, unknown>, PANEL_SESSION_COOKIE.name);
    const parsed = OpaqueToken.safeParse(value);
    return { token: parsed.success ? parsed.data : undefined, presented: value !== undefined };
  }

  set(reply: unknown, token: string, expiresAt: Date): void {
    const remainingMs = expiresAt.getTime() - this.clock.now().getTime();
    this.adapter.setCookie(reply, PANEL_SESSION_COOKIE.name, token, {
      ...ATTRIBUTES,
      maxAge: Math.max(0, Math.floor(remainingMs / 1000)),
    });
  }

  clear(reply: unknown): void {
    this.adapter.clearCookie(reply, PANEL_SESSION_COOKIE.name, ATTRIBUTES);
  }

  /** Ответы API панели не кешируются — до работы обработчика, чтобы попасть и в ответ-ошибку. */
  noStore(reply: unknown): void {
    this.adapter.setHeader(reply, 'Cache-Control', 'no-store');
  }

  private get adapter() {
    return this.adapterHost.httpAdapter;
  }
}
