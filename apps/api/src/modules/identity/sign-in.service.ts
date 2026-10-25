import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  normalizeEmail,
  type RateLimitedDetails,
  type RegisterResponse,
  type Session,
} from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { IDENTITY_POLICY } from './identity.policy';
import { IdentityRepository } from './identity.repository';
import { PasswordHasher } from './password-hasher';
import { RegistrationService } from './registration.service';
import { SessionService } from './session.service';
import { signInLimitKeys } from './tokens';

export type SignInResult =
  { state: 'signedIn'; session: Session } | ({ state: 'verificationRequired' } & RegisterResponse);

const invalidCredentials = () => domainError('INVALID_CREDENTIALS', 401);

/**
 * Вход по e-mail и паролю (ADR-0005). Порядок: лимиты (до argon2) → проверка пароля (для неизвестного и
 * удалённого адреса — по пустышке, время ответа то же) → неподтверждённому — токен регистрации (AD-28, Q4),
 * подтверждённому — сессия через `SessionService.issue`.
 */
@Injectable()
export class SignInService implements OnModuleInit {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly transactions: MongoTransactions,
    private readonly sessions: SessionService,
    private readonly registration: RegistrationService,
    private readonly hasher: PasswordHasher,
    private readonly rateLimiter: RateLimiter,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Пустышка считается при старте: первый вход с неизвестным адресом не дольше остальных. */
  async onModuleInit(): Promise<void> {
    await this.hasher.dummyHash();
  }

  async signIn(input: { email: string; password: string }, ip: string): Promise<SignInResult> {
    const now = this.clock.now();
    const email = normalizeEmail(input.email);
    await this.takeAttempt(email, ip, now);

    const account = await this.repository.findCredentialsByEmail(email);
    const known = account !== undefined && account.deletedAt === null;
    const passwordHash = known ? account.passwordHash : await this.hasher.dummyHash();
    const valid = await this.hasher.verify(passwordHash, input.password);
    if (!known || !valid) throw invalidCredentials();

    return this.transactions.run(async (tx) => {
      // под блокировкой аккаунта (R1): подтверждение, очистка, poll и сброс пароля того же аккаунта идут по очереди;
      // сброс «в процессе» даёт конфликт записи — вход повторяется после его коммита и видит новый хеш
      const user = await this.repository.lockUserCredentials(tx, account.id);
      // пароль сменили между проверкой и блокировкой (сброс отозвал все сессии) — старый пароль сессию не получает (R4)
      if (!user || user.deletedAt || user.passwordHash !== account.passwordHash) {
        throw invalidCredentials();
      }
      if (!user.emailVerifiedAt) {
        const pending = await this.registration.reissueToken(tx, user.id, user.email, now);
        return { state: 'verificationRequired' as const, ...pending };
      }
      return { state: 'signedIn' as const, session: await this.sessions.issue(tx, user.id) };
    });
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
