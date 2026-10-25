import { Body, Controller, Get, Header, HttpCode, Ip, Param, Post, Res } from '@nestjs/common';
import {
  ConfirmPasswordResetRequest,
  type ConfirmPasswordResetResponse,
  ConfirmVerificationRequest,
  type ConfirmVerificationResponse,
  FieldErrorCode,
  type PasswordResetLinkInfo,
  PasswordResetToken,
  RegisterRequest,
  type RegisterResponse,
  RegistrationPollRequest,
  type RegistrationPollResponse,
  RequestPasswordResetRequest,
  type RequestPasswordResetResponse,
  ResendVerificationRequest,
  type ResendVerificationResponse,
  type VerificationLinkInfo,
  VerificationToken,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { PasswordResetService } from './password-reset.service';
import { RegistrationService } from './registration.service';
import { SessionCookie } from './session-cookie';
import { VerificationService } from './verification.service';

/**
 * Публичные эндпоинты регистрации и сброса пароля. Тонкий слой: контракт → сервис. Ответы с токенами не кешируются. Сброс пароля —
 * вне `/v1/auth/session`: cookie сессии не получает и сессию не выдаёт (R3 слайса 3).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly verification: VerificationService,
    private readonly cookie: SessionCookie,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  register(
    @Body(new ZodValidationPipe(RegisterRequest, FieldErrorCode)) body: RegisterRequest,
    @Ip() ip: string,
  ): Promise<RegisterResponse> {
    return this.registration.register(body, ip);
  }

  /** Открытие ссылки ничего не меняет. Мусор вместо токена — как неизвестный токен (404). */
  @Get('verification/:token')
  @Header('Cache-Control', 'no-store')
  describeLink(@Param('token') token: string): Promise<VerificationLinkInfo> {
    if (!VerificationToken.safeParse(token).success) throw domainError('NOT_FOUND', 404);
    return this.verification.describeLink(token);
  }

  @Post('verification/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  confirm(
    @Body(new ZodValidationPipe(ConfirmVerificationRequest, FieldErrorCode))
    body: ConfirmVerificationRequest,
  ): Promise<ConfirmVerificationResponse> {
    return this.verification.confirm(body.token);
  }

  @Post('verification/resend')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  resend(
    @Body(new ZodValidationPipe(ResendVerificationRequest, FieldErrorCode))
    body: ResendVerificationRequest,
  ): Promise<ResendVerificationResponse> {
    return this.verification.resend(body);
  }

  /** Сессия — по транспорту клиента: `cookie` (web) — refresh в httpOnly cookie, без него — прежний `Session`. */
  @Post('registration/poll')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async poll(
    @Body(new ZodValidationPipe(RegistrationPollRequest, FieldErrorCode))
    body: RegistrationPollRequest,
    @Res({ passthrough: true }) reply: unknown,
  ): Promise<RegistrationPollResponse> {
    const result = await this.registration.poll(body.registrationToken);
    if (result.state === 'pending') return result;
    const transport = body.sessionTransport ?? 'body';
    return { state: 'verified', session: this.cookie.deliver(reply, result.session, transport) };
  }

  /** Запрос ссылки: один и тот же ответ для любого адреса; лимиты IP и e-mail — в сервисе. */
  @Post('password-reset')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  requestPasswordReset(
    @Body(new ZodValidationPipe(RequestPasswordResetRequest, FieldErrorCode))
    body: RequestPasswordResetRequest,
    @Ip() ip: string,
  ): Promise<RequestPasswordResetResponse> {
    return this.passwordReset.requestReset(body, ip);
  }

  /** Открытие ссылки сброса ничего не меняет. Мусор вместо токена — как неизвестный токен (404). */
  @Get('password-reset/:token')
  @Header('Cache-Control', 'no-store')
  describePasswordResetLink(@Param('token') token: string): Promise<PasswordResetLinkInfo> {
    if (!PasswordResetToken.safeParse(token).success) throw domainError('NOT_FOUND', 404);
    return this.passwordReset.describeLink(token);
  }

  @Post('password-reset/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  confirmPasswordReset(
    @Body(new ZodValidationPipe(ConfirmPasswordResetRequest, FieldErrorCode))
    body: ConfirmPasswordResetRequest,
  ): Promise<ConfirmPasswordResetResponse> {
    return this.passwordReset.confirm(body);
  }
}
