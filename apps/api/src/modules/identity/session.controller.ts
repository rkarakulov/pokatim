import { Body, Controller, Cookies, HttpCode, Ip, Post, Res } from '@nestjs/common';
import {
  FieldErrorCode,
  OpaqueToken,
  RefreshSessionRequest,
  type RefreshSessionResponse,
  SESSION_COOKIE,
  SignInRequest,
  type SignInResponse,
  SignOutRequest,
} from '@pokatim/contracts';
import { isDomainError, ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { SessionCookie } from './session-cookie';
import { SessionService } from './session.service';
import { SignInService } from './sign-in.service';

/** Refresh из cookie: мусор и отсутствие — как неизвестный токен, до лимита и БД. */
function cookieToken(value: string | undefined): string | undefined {
  const parsed = OpaqueToken.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Сессия (R4 F5b, ADR-0005): вход, ротация, выход. Транспорт refresh: `refreshToken` в теле → `body` (native), иначе —
 * cookie `SESSION_COOKIE` (web, ответ без refresh). Тонкий слой: транспорт и заголовки здесь, решения — в сервисах.
 */
@Controller('auth/session')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly signInService: SignInService,
    private readonly cookie: SessionCookie,
  ) {}

  /**
   * Вход по паролю. Путь под `SESSION_COOKIE.path` (R4): прежняя cookie этого браузера приходит сюда — после
   * успешного входа её сессия отзывается (`superseded`), иначе она осталась бы живой без владельца в браузере.
   */
  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body(new ZodValidationPipe(SignInRequest, FieldErrorCode)) body: SignInRequest,
    @Cookies(SESSION_COOKIE.name) cookieValue: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<SignInResponse> {
    this.cookie.noStore(reply);
    const result = await this.signInService.signIn(body, ip);
    if (result.state === 'verificationRequired') return result;

    const previous = cookieToken(cookieValue);
    // сбой отзыва прежней сессии вход не отменяет: новая сессия уже выдана
    if (previous) await this.sessions.revoke(previous, 'superseded').catch(() => undefined);
    const transport = body.sessionTransport ?? 'body';
    return { state: 'signedIn', session: this.cookie.deliver(reply, result.session, transport) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(RefreshSessionRequest, FieldErrorCode)) body: RefreshSessionRequest,
    @Cookies(SESSION_COOKIE.name) cookieValue: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<RefreshSessionResponse> {
    this.cookie.noStore(reply);
    if (body.refreshToken !== undefined) return this.sessions.rotate(body.refreshToken, ip);

    try {
      const token = cookieToken(cookieValue);
      if (!token) throw domainError('UNAUTHORIZED', 401);
      return this.cookie.deliver(reply, await this.sessions.rotate(token, ip), 'cookie');
    } catch (error) {
      // недействительная cookie больше не нужна браузеру; 429 и сбои — не повод её стирать. Без cookie сбрасывать
      // нечего: запоздалый ответ анонимного refresh стёр бы cookie, выданную тем временем poll другой вкладки
      const presented = cookieValue !== undefined;
      if (presented && isDomainError(error) && error.status === 401) this.cookie.clear(reply);
      throw error;
    }
  }

  /** Идемпотентно: 204 без тела в любом случае — ответ не говорит, была ли сессия. */
  @Post('sign-out')
  @HttpCode(204)
  async signOut(
    @Body(new ZodValidationPipe(SignOutRequest, FieldErrorCode)) body: SignOutRequest,
    @Cookies(SESSION_COOKIE.name) cookieValue: string | undefined,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<void> {
    this.cookie.noStore(reply);
    if (body.refreshToken !== undefined) {
      await this.sessions.revoke(body.refreshToken);
      return;
    }
    const token = cookieToken(cookieValue);
    if (token) await this.sessions.revoke(token);
    this.cookie.clear(reply);
  }
}
