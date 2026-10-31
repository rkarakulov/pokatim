import { Injectable } from '@nestjs/common';
import { InviteCode } from '@pokatim/contracts';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import { IDENTITY_ACCOUNT_CONFIRMED, type IdentityAccountConfirmed } from './identity.events';
import { IdentityRepository } from './identity.repository';

/**
 * Первое подтверждение e-mail — общий шаг обоих путей (ссылка из письма и сброс пароля, RC-P6-1). В транзакции
 * вызывающего под `lockUser`: условная запись `emailVerifiedAt` и, если аккаунт зарегистрирован с кодом, событие
 * `identity.account-confirmed` (P6). Повторное подтверждение события не пишет.
 */
@Injectable()
export class AccountConfirmation {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly outbox: MongoOutboxWriter,
  ) {}

  async confirmEmail(tx: DbSession, userId: string, at: Date): Promise<void> {
    const confirmed = await this.repository.markEmailVerified(tx, userId, at);
    if (!confirmed?.invite) return;
    const invite = InviteCode.safeParse(confirmed.invite);
    if (!invite.success) return;
    const payload: IdentityAccountConfirmed = { userId, invite: invite.data };
    await this.outbox.append(tx, { type: IDENTITY_ACCOUNT_CONFIRMED, payload });
  }
}
