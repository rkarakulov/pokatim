import { type CookieSerializeOptions, Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { OpaqueToken, PANEL_DEVICE_COOKIE, PANEL_SESSION_COOKIE } from '@pokatim/contracts';
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

/** Cookie доверенного устройства (ADR-0024, D4): те же атрибуты, путь — только вход панели. */
const DEVICE_ATTRIBUTES = { ...ATTRIBUTES, path: PANEL_DEVICE_COOKIE.path } as const;

/**
 * Значение cookie запроса: `request.cookies`, если его заполнил плагин, иначе — разбор заголовка `Cookie` (адаптер
 * Fastify без `@fastify/cookie` объект не заполняет; `@Cookies()` Nest разбирает заголовок так же). Только собственные
 * ключи; значение проверяет вызывающий (`OpaqueToken`).
 */
export function requestCookie(request: unknown, name: string): string | undefined {
  const { cookies, headers } = request as {
    cookies?: Record<string, string | undefined>;
    headers?: Record<string, unknown>;
  };
  if (cookies && typeof cookies === 'object') {
    return Object.hasOwn(cookies, name) ? cookies[name] : undefined;
  }
  const header = headers?.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * Cookie сессии панели (ADR-0009): идентификатор генерирует только сервер при входе (фиксация невозможна),
 * `Max-Age` — остаток абсолютного срока.
 */
@Injectable()
export class PanelSessionCookie {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Токен из cookie запроса: мусор и отсутствие — `undefined` (до БД). `presented` — cookie была. */
  read(request: unknown): { token: string | undefined; presented: boolean } {
    const value = requestCookie(request, PANEL_SESSION_COOKIE.name);
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

  /** Токен доверенного устройства из cookie запроса (мусор — `undefined`). */
  readDevice(request: unknown): string | undefined {
    const parsed = OpaqueToken.safeParse(requestCookie(request, PANEL_DEVICE_COOKIE.name));
    return parsed.success ? parsed.data : undefined;
  }

  setDevice(reply: unknown, token: string, expiresAt: Date): void {
    const remainingMs = expiresAt.getTime() - this.clock.now().getTime();
    this.adapter.setCookie(reply, PANEL_DEVICE_COOKIE.name, token, {
      ...DEVICE_ATTRIBUTES,
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
