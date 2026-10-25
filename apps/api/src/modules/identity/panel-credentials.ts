import { Inject, Injectable } from '@nestjs/common';
import type { RegisterResponse } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { MongoTransactions } from '../../db';
import { CredentialsCheck, invalidCredentials } from './credentials-check';
import { IdentityRepository } from './identity.repository';
import { RegistrationService } from './registration.service';
import { credentialsStamp } from './tokens';

/** Подтверждённый аккаунт с верным паролем; штамп — из того же прочитанного хеша (R2 admin-01). */
export interface VerifiedCredentials {
  userId: string;
  email: string;
  credentialsStamp: string;
}

export type PanelCredentialsResult =
  | ({ state: 'verified' } & VerifiedCredentials)
  | ({ state: 'verificationRequired' } & RegisterResponse);

/**
 * Узкий порт identity для входа в панель «Протокол» (ADR-0009): та же проверка e-mail и пароля, что у входа
 * приложения (`CredentialsCheck`: общие счётчики лимитов, пустышка argon2, один 401). Сессию приложения не выдаёт —
 * сессию панели выдаёт модуль `panel`.
 * - неизвестен / удалён / неверный пароль — `401 INVALID_CREDENTIALS`, 429 — как у приложения (`DomainError`);
 * - не подтверждён — под `lockUserCredentials` со сверкой хеша перевыпуск токена регистрации (как `SignInService`);
 * - подтверждён — без транзакции `{ userId, email, credentialsStamp }`: гонку со сбросом пароля закрывает гард
 *   панели сверкой штампа на каждом запросе.
 */
@Injectable()
export class PanelCredentials {
  constructor(
    private readonly credentials: CredentialsCheck,
    private readonly repository: IdentityRepository,
    private readonly transactions: MongoTransactions,
    private readonly registration: RegistrationService,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async verify(
    input: { email: string; password: string },
    ip: string,
  ): Promise<PanelCredentialsResult> {
    const now = this.clock.now();
    const account = await this.credentials.check(input, ip);
    const verified = (passwordHash: string) => ({
      state: 'verified' as const,
      userId: account.id,
      email: account.email,
      credentialsStamp: credentialsStamp(this.env.EMAIL_TOKEN_SECRET, passwordHash),
    });
    if (account.emailVerifiedAt) return verified(account.passwordHash);

    return this.transactions.run(async (tx) => {
      // как вход приложения (R1, R4 слайса 3): под блокировкой аккаунта пароль не сменили с момента проверки
      const user = await this.repository.lockUserCredentials(tx, account.id);
      if (!user || user.deletedAt || user.passwordHash !== account.passwordHash) {
        throw invalidCredentials();
      }
      // подтвердили между проверкой и блокировкой — вход как подтверждённого
      if (user.emailVerifiedAt) return verified(user.passwordHash);
      const pending = await this.registration.reissueToken(tx, user.id, user.email, now);
      return { state: 'verificationRequired' as const, ...pending };
    });
  }
}
