import { Inject, Injectable } from '@nestjs/common';
import type { PanelRole } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import { IdentityAccounts } from '../identity';
import { PanelAudit } from './panel-audit';
import type { AuditActor, PanelMemberDoc } from './panel.collection';
import { PanelRepository } from './panel.repository';

export type CliGrantResult =
  | { state: 'granted'; userId: string }
  | { state: 'alreadyAdmin'; userId: string }
  | { state: 'notFound' }
  | { state: 'unverified' };

/**
 * Члены команды панели: выдача, смена и снятие роли (ADR-0009). Транзакции меняют только документы `panel_*`:
 * `lockAdmins` (если затронут набор активных администраторов) → `lockMember` → изменение → запись журнала.
 */
@Injectable()
export class PanelMembersService {
  constructor(
    private readonly repository: PanelRepository,
    private readonly audit: PanelAudit,
    private readonly accounts: IdentityAccounts,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * CLI `grant-admin` (первый и аварийный администратор, Q10): роль `admin` подтверждённому пользователю. Уже
   * активный `admin` — без изменений и без записи; активный с другой ролью — повышение; снятый — повторная
   * активация. Журнал — актор `cli`.
   */
  async grantAdminFromCli(email: string, displayName: string): Promise<CliGrantResult> {
    const account = await this.accounts.findVerifiedByEmail(email);
    if (!account) return { state: 'notFound' };
    if (!account.verified) return { state: 'unverified' };
    const { userId } = account;
    const actor: AuditActor = { kind: 'cli' };

    const changed = await this.runWithInsertRetry(async (tx) => {
      await this.repository.lockAdmins(tx);
      const current = await this.repository.lockMember(tx, userId);
      if (current?.status === 'active' && current.role === 'admin') return false;
      await this.activate(tx, current, { userId, role: 'admin', displayName });
      await this.audit.append(tx, {
        action: 'panel.role_granted',
        actor,
        targetUserId: userId,
        details:
          current?.status === 'active'
            ? { roleFrom: current.role, roleTo: 'admin' }
            : { roleTo: 'admin' },
      });
      return true;
    });
    return changed ? { state: 'granted', userId } : { state: 'alreadyAdmin', userId };
  }

  /**
   * Новый документ, повторная активация снятого или смена роли активного (CLI) — под `lockMember` вызывающего.
   */
  private async activate(
    tx: DbSession,
    current: PanelMemberDoc | undefined,
    member: { userId: string; role: PanelRole; displayName: string },
  ): Promise<void> {
    const grantedAt = this.clock.now();
    if (!current) {
      await this.repository.insertMember(tx, { ...member, grantedAt });
    } else if (current.status === 'revoked') {
      await this.repository.reactivateMember(tx, { ...member, grantedAt });
    } else {
      await this.repository.setRole(tx, member.userId, member.role);
    }
  }

  /**
   * Транзакция с повтором после `_id_`: две первые выдачи одному пользователю — проигравшая получает duplicate key
   * (не transient, `MongoTransactions` не повторяет) и выполняется заново, уже видя документ победившей.
   */
  private async runWithInsertRetry<T>(work: (tx: DbSession) => Promise<T>): Promise<T> {
    try {
      return await this.transactions.run(work);
    } catch (error) {
      if (!isDuplicateKey(error, '_id_')) throw error;
      return this.transactions.run(work);
    }
  }
}
