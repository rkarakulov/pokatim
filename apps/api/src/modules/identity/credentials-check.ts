import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { normalizeEmail, type RateLimitedDetails } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { IDENTITY_POLICY } from './identity.policy';
import { type CheckedCredentials, IdentityRepository } from './identity.repository';
import { PasswordHasher } from './password-hasher';
import { signInLimitKeys } from './tokens';

export const invalidCredentials = () => domainError('INVALID_CREDENTIALS', 401);

/**
 * Проверка e-mail и пароля — общая для входа приложения (`SignInService`) и входа в панель (`PanelCredentials`,
 * ADR-0009): одна механика и **одни счётчики** лимитов (R3 admin-01: один пароль — одна цель перебора). Порядок:
 * лимиты (до argon2) → поиск → argon2 (для неизвестного и удалённого адреса — по пустышке, время то же) → один
 * `401 INVALID_CREDENTIALS`. Решения после проверки (сессия, токен регистрации) — у вызывающего.
 */
@Injectable()
export class CredentialsCheck implements OnModuleInit {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly hasher: PasswordHasher,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Пустышка считается при старте: первый вход с неизвестным адресом не дольше остальных. */
  async onModuleInit(): Promise<void> {
    await this.hasher.dummyHash();
  }

  async check(input: { email: string; password: string }, ip: string): Promise<CheckedCredentials> {
    const account = await this.verify(input, ip);
    if (!account) throw invalidCredentials();
    return account;
  }

  /**
   * Та же проверка без решения об ответе: лимиты (429 — `DomainError`) → поиск → argon2 по хешу или пустышке;
   * неверный пароль, неизвестный, удалённый и стёртый аккаунт — `undefined`. Вызывающий выбирает код отказа (вход —
   * `401 INVALID_CREDENTIALS`, удаление аккаунта — `403 PASSWORD_INCORRECT`).
   */
  async verify(
    input: { email: string; password: string },
    ip: string,
  ): Promise<CheckedCredentials | undefined> {
    const email = normalizeEmail(input.email);
    await this.takeAttempt(email, ip, this.clock.now());

    const account = await this.repository.findCredentialsByEmail(email);
    const known = account !== undefined && account.deletedAt === null;
    const passwordHash = known ? account.passwordHash : await this.hasher.dummyHash();
    const valid = await this.hasher.verify(passwordHash, input.password);
    return known && valid ? account : undefined;
  }

  /**
   * Счётчики по очереди — IP → e-mail+IP → e-mail (R1б, R2а: считаются все попытки), до первого отказа: отказанная
   * попытка дальше не списывается. Иначе ошибки с одного адреса сверх его лимита копили бы общий счётчик e-mail, и
   * один IP блокировал бы владельца везде. Отказ — 429 с паузой отказавшего правила, одинаково для существующих и
   * несуществующих адресов; пароль не проверяется.
   */
  private async takeAttempt(email: string, ip: string, now: Date): Promise<void> {
    const keys = signInLimitKeys(this.env.EMAIL_TOKEN_SECRET, email, ip);
    const limits = IDENTITY_POLICY.signInLimits;
    const rules = [
      [keys.ip, limits.ip],
      [keys.emailIp, limits.emailIp],
      [keys.email, limits.email],
    ] as const;
    for (const [key, rule] of rules) {
      const result = await this.rateLimiter.consume(key, rule, now);
      if (!result.allowed) {
        const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
        throw domainError('RATE_LIMITED', 429, details);
      }
    }
  }
}
