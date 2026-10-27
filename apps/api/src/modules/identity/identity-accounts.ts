import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail } from '@pokatim/contracts';
import { ENV } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { IdentityRepository } from './identity.repository';
import { credentialsStamp } from './tokens';

/** Состояние аккаунта для гарда панели: `active` — не удалён и подтверждён; штамп — от текущего хеша пароля. */
export interface AccountState {
  active: boolean;
  credentialsStamp: string;
}

/**
 * Чтения аккаунтов приложения для модулей `panel` (ADR-0009) и `notifications` (ADR-0016): коллекции identity читает
 * только identity. Без лимитера и Redis — порт годится и для CLI. Значения фильтров — id после zod и нормализованный
 * e-mail.
 */
@Injectable()
export class IdentityAccounts {
  constructor(
    private readonly repository: IdentityRepository,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
  ) {}

  async accountState(userId: string): Promise<AccountState | undefined> {
    const account = await this.repository.findCredentialsById(userId);
    if (!account) return undefined;
    return {
      active: account.deletedAt === null && account.emailVerifiedAt !== null,
      credentialsStamp: credentialsStamp(this.env.EMAIL_TOKEN_SECRET, account.passwordHash),
    };
  }

  /** Аккаунт по e-mail для выдачи роли; удалённый — как неизвестный. */
  async findVerifiedByEmail(
    email: string,
  ): Promise<{ userId: string; verified: boolean } | undefined> {
    const user = await this.repository.findUserByEmail(normalizeEmail(email));
    if (!user || user.deletedAt) return undefined;
    return { userId: user.id, verified: user.emailVerifiedAt !== null };
  }

  /** E-mail живых аккаунтов по id; удалённых в карте нет («Удалённый участник» — у вызывающего). */
  emailsOf(userIds: readonly string[]): Promise<Map<string, string>> {
    return this.repository.findEmailsByIds(userIds);
  }

  /** Живые (не удалённые) аккаунты из `userIds` — получатели уведомлений (`notifications`, RC-4). */
  liveUserIds(userIds: readonly string[]): Promise<Set<string>> {
    return this.repository.findLiveIds(userIds);
  }
}
