import { Inject, Injectable } from '@nestjs/common';
import type {
  ChangeRoleRequest,
  GrantRoleRequest,
  PanelMember,
  PanelMemberList,
  PanelRole,
  RevokeRoleRequest,
  TotpResetRequest,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { IdentityAccounts } from '../identity';
import { PanelAudit } from './panel-audit';
import type { AuditActor, PanelMemberDoc } from './panel.collection';
import { DELETED_MEMBER, PANEL_POLICY } from './panel.policy';
import { PanelRepository } from './panel.repository';

export type CliGrantResult =
  | { state: 'granted'; userId: string }
  | { state: 'alreadyAdmin'; userId: string }
  | { state: 'notFound' }
  | { state: 'unverified' };

export type CliTotpResetResult =
  | { state: 'reset'; userId: string }
  | { state: 'notEnabled'; userId: string }
  | { state: 'notFound' };

/** Причина записи журнала аварийного сброса 2FA через CLI. */
export const CLI_TOTP_RESET_REASON = 'Аварийный сброс 2FA (CLI)';

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

  /** Список «Сотрудники» (до `memberListCap`, все статусы) + e-mail одним запросом `$in`. */
  async list(): Promise<PanelMemberList> {
    const cap = PANEL_POLICY.memberListCap;
    const docs = await this.repository.listMembers(cap + 1);
    const items = docs.slice(0, cap);
    const ids = items.map((doc) => doc._id);
    const [emails, totp] = await Promise.all([
      this.accounts.emailsOf(ids),
      this.repository.totpEnabledOf(ids),
    ]);
    return {
      items: items.map((doc) => toPanelMember(doc, emails, totp)),
      truncated: docs.length > cap,
    };
  }

  /**
   * Выдать роль существующему подтверждённому пользователю по e-mail (R4а): нет аккаунта — 404, не подтверждён — 409
   * `PANEL_USER_UNVERIFIED`, уже активный член — 409 `PANEL_ALREADY_MEMBER`, снятый — повторная активация с новой
   * ролью. Журнал `panel.role_granted { roleTo }` — в той же транзакции.
   */
  async grant(actorUserId: string, input: GrantRoleRequest): Promise<PanelMember> {
    const account = await this.accounts.findVerifiedByEmail(input.email);
    if (!account) throw domainError('NOT_FOUND', 404);
    if (!account.verified) throw domainError('PANEL_USER_UNVERIFIED', 409);
    const { userId } = account;

    await this.runWithInsertRetry(async (tx) => {
      // выдача admin расширяет набор администраторов — тот же замок, что у понижения и снятия (R7)
      if (input.role === 'admin') await this.repository.lockAdmins(tx);
      const current = await this.repository.lockMember(tx, userId);
      if (current?.status === 'active') throw domainError('PANEL_ALREADY_MEMBER', 409);
      await this.activate(tx, current, {
        userId,
        role: input.role,
        displayName: input.displayName,
      });
      await this.audit.append(tx, {
        action: 'panel.role_granted',
        actor: { kind: 'user', userId: actorUserId },
        targetUserId: userId,
        details: { roleTo: input.role },
      });
    });
    return this.member(userId);
  }

  /** Сменить роль (причина обязательна); права — со следующего запроса сотрудника (гард читает роль). */
  async changeRole(
    actorUserId: string,
    userId: string,
    input: ChangeRoleRequest,
  ): Promise<PanelMember> {
    if (actorUserId === userId) throw domainError('PANEL_SELF_ACTION', 409);
    await this.transactions.run(async (tx) => {
      const current = await this.lockForChange(
        tx,
        userId,
        (role) => role === 'admin' || input.role === 'admin',
      );
      if (current.role === input.role) return;
      await this.ensureAdminRemains(tx, current.role === 'admin' && input.role !== 'admin');
      await this.repository.setRole(tx, userId, input.role);
      await this.audit.append(tx, {
        action: 'panel.role_changed',
        actor: { kind: 'user', userId: actorUserId },
        targetUserId: userId,
        reason: input.reason,
        details: { roleFrom: current.role, roleTo: input.role },
      });
    });
    return this.member(userId);
  }

  /**
   * Снять роль (причина обязательна): все сессии панели сотрудника отзываются в той же транзакции; сессия
   * приложения не трогается.
   */
  async revoke(
    actorUserId: string,
    userId: string,
    input: RevokeRoleRequest,
  ): Promise<PanelMember> {
    if (actorUserId === userId) throw domainError('PANEL_SELF_ACTION', 409);
    await this.transactions.run(async (tx) => {
      const current = await this.lockForChange(tx, userId, (role) => role === 'admin');
      await this.ensureAdminRemains(tx, current.role === 'admin');
      const now = this.clock.now();
      await this.repository.revokeMember(tx, userId, now);
      await this.repository.revokeAllSessions(tx, userId, now, 'role_revoked');
      await this.audit.append(tx, {
        action: 'panel.role_revoked',
        actor: { kind: 'user', userId: actorUserId },
        targetUserId: userId,
        reason: input.reason,
        details: { roleFrom: current.role },
      });
    });
    return this.member(userId);
  }

  /**
   * Порядок замков (R7): роль из снимка транзакции решает, затронут ли набор администраторов; если да — сначала
   * `lockAdmins`, затем `lockMember`. Параллельная смена той же записи даёт конфликт на `lockMember` — повтор на свежем
   * снимке. Не активен — 404.
   */
  private async lockForChange(
    tx: DbSession,
    userId: string,
    touchesAdmins: (role: PanelRole) => boolean,
  ): Promise<PanelMemberDoc> {
    const snapshot = await this.repository.findMember(tx, userId);
    if (snapshot?.status !== 'active') throw domainError('NOT_FOUND', 404);
    if (touchesAdmins(snapshot.role)) await this.repository.lockAdmins(tx);
    const current = await this.repository.lockMember(tx, userId);
    if (current?.status !== 'active') throw domainError('NOT_FOUND', 404);
    return current;
  }

  /** Изменение убирает администратора — после него должен остаться хотя бы один активный (под `lockAdmins`). */
  private async ensureAdminRemains(tx: DbSession, removesAdmin: boolean): Promise<void> {
    if (!removesAdmin) return;
    if ((await this.repository.countActiveAdmins(tx)) <= 1) {
      throw domainError('PANEL_LAST_ADMIN', 409);
    }
  }

  private async member(userId: string): Promise<PanelMember> {
    const [doc] = await this.repository.listMembersByIds([userId]);
    if (!doc) throw domainError('NOT_FOUND', 404);
    const [emails, totp] = await Promise.all([
      this.accounts.emailsOf([userId]),
      this.repository.totpEnabledOf([userId]),
    ]);
    return toPanelMember(doc, emails, totp);
  }

  /**
   * Сброс 2FA сотрудника (ADR-0024, D10; `members.manage`, причина обязательна): себе — `409 PANEL_SELF_ACTION`, не
   * член команды — 404, 2FA не подключена — `409 TOTP_NOT_ENABLED`. Одной транзакцией: удаление 2FA (и незавершённого
   * подключения), доверенных устройств, отзыв всех сессий панели цели (`totp_reset`), `panel.totp_reset`.
   */
  async resetTotp(actorUserId: string, userId: string, input: TotpResetRequest): Promise<void> {
    if (actorUserId === userId) throw domainError('PANEL_SELF_ACTION', 409);
    const [member] = await this.repository.listMembersByIds([userId]);
    if (!member) throw domainError('NOT_FOUND', 404);
    const reset = await this.transactions.run((tx) =>
      this.resetIn(tx, userId, { kind: 'user', userId: actorUserId }, input.reason),
    );
    if (!reset) throw domainError('TOTP_NOT_ENABLED', 409);
  }

  /** CLI `reset-totp` (аварийный путь, последний admin): то же действие с актором `cli`. */
  async resetTotpFromCli(email: string): Promise<CliTotpResetResult> {
    const account = await this.accounts.findVerifiedByEmail(email);
    if (!account) return { state: 'notFound' };
    const { userId } = account;
    const reset = await this.transactions.run((tx) =>
      this.resetIn(tx, userId, { kind: 'cli' }, CLI_TOTP_RESET_REASON),
    );
    return reset ? { state: 'reset', userId } : { state: 'notEnabled', userId };
  }

  private async resetIn(
    tx: DbSession,
    userId: string,
    actor: AuditActor,
    reason: string,
  ): Promise<boolean> {
    const current = await this.repository.findTotp(userId, tx);
    if (current?.status !== 'active') return false;
    const now = this.clock.now();
    await this.repository.deleteTotp(tx, userId);
    await this.repository.deleteTrustedDevices(tx, userId);
    await this.repository.revokeAllSessions(tx, userId, now, 'totp_reset');
    await this.audit.append(tx, {
      action: 'panel.totp_reset',
      actor,
      targetUserId: userId,
      reason,
    });
    return true;
  }

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

function toPanelMember(
  doc: PanelMemberDoc,
  emails: Map<string, string>,
  totpEnabled: Set<string>,
): PanelMember {
  return {
    userId: doc._id,
    displayName: doc.displayName,
    email: emails.get(doc._id) ?? DELETED_MEMBER,
    role: doc.role,
    status: doc.status,
    grantedAt: doc.grantedAt.toISOString(),
    revokedAt: doc.revokedAt?.toISOString() ?? null,
    totpEnabled: totpEnabled.has(doc._id),
  };
}
