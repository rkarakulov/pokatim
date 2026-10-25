import { Injectable } from '@nestjs/common';

import { IdentityAccounts } from '../identity';
import type {
  PanelMemberDoc,
  PanelSessionDoc,
  PanelSessionRevokedReason,
} from './panel.collection';
import { PanelRepository } from './panel.repository';

export type SessionVerdict =
  { valid: true; member: PanelMemberDoc } | { valid: false; reason: PanelSessionRevokedReason };

/**
 * Годна ли живая сессия панели (ADR-0009): аккаунт приложения не удалён и подтверждён → штамп учётных данных совпадает
 * с записанным при входе → член команды `active`. Один источник для `PanelGuard` и выхода: отказ — причина отзыва.
 */
@Injectable()
export class PanelSessionCheck {
  constructor(
    private readonly accounts: IdentityAccounts,
    private readonly repository: PanelRepository,
  ) {}

  async verdict(session: PanelSessionDoc): Promise<SessionVerdict> {
    const account = await this.accounts.accountState(session.userId);
    if (!account?.active) return { valid: false, reason: 'account_inactive' };
    if (account.credentialsStamp !== session.credentialsStamp) {
      return { valid: false, reason: 'credentials_changed' };
    }
    const member = await this.repository.findActiveMember(session.userId);
    return member ? { valid: true, member } : { valid: false, reason: 'role_revoked' };
  }
}
