import { Inject, Injectable } from '@nestjs/common';
import type { RegisterResponse, Session } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { CredentialsCheck, invalidCredentials } from './credentials-check';
import { IdentityRepository } from './identity.repository';
import { RegistrationService } from './registration.service';
import { SessionService } from './session.service';

export type SignInResult =
  { state: 'signedIn'; session: Session } | ({ state: 'verificationRequired' } & RegisterResponse);

/**
 * Вход по e-mail и паролю (ADR-0005). Порядок: лимиты и проверка пароля — `CredentialsCheck` (общая с входом в
 * панель) → неподтверждённому — токен регистрации (AD-28, Q4), подтверждённому — сессия через `SessionService.issue`.
 */
@Injectable()
export class SignInService {
  constructor(
    private readonly credentials: CredentialsCheck,
    private readonly repository: IdentityRepository,
    private readonly transactions: MongoTransactions,
    private readonly sessions: SessionService,
    private readonly registration: RegistrationService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async signIn(input: { email: string; password: string }, ip: string): Promise<SignInResult> {
    const now = this.clock.now();
    const account = await this.credentials.check(input, ip);

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
}
