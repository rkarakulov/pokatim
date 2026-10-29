import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import type { DbSession } from '../../db';
import { IdentityAccounts } from '../identity';
import type { PanelMemberDoc } from './panel.collection';
import { PanelRepository } from './panel.repository';

/** Кто совершает мутацию 2FA: по вызову второго шага входа или по сессии панели (настройки, сброс другому). */
export type TotpRecheckSubject =
  | { kind: 'challenge'; userId: string; credentialsStamp: string }
  | { kind: 'session'; userId: string; sessionId: string };

/**
 * Перепроверка авторизации мутации 2FA в её транзакции (ADR-0024, ревью pass 5) — один helper для всех путей, чтобы ни
 * один не забыл проверку, сделанную до транзакции (гард, вызов):
 * 1. замок аккаунта (`IdentityAccounts.lockAccountState`, R1) → аккаунт активен, штамп учётных данных = штамп вызова
 *    или сессии (сброс пароля и удаление аккаунта сериализуются с мутацией);
 * 2. для сессии — она жива в снимке транзакции: своя, не отозвана, не истекла;
 * 3. замок члена команды (`lockMember`) → `active`; возвращается документ под замком — актуальная роль (обязательность
 *    2FA, права) берётся из него, а не из гарда.
 * Отказ — `fail()` (транзакция откатывается).
 */
@Injectable()
export class PanelTotpGuard {
  constructor(
    private readonly accounts: IdentityAccounts,
    private readonly repository: PanelRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async recheck(
    tx: DbSession,
    subject: TotpRecheckSubject,
    fail: () => Error,
  ): Promise<PanelMemberDoc> {
    const account = await this.accounts.lockAccountState(tx, subject.userId);
    if (!account?.active) throw fail();
    const stamp =
      subject.kind === 'challenge'
        ? subject.credentialsStamp
        : await this.liveSessionStamp(tx, subject.userId, subject.sessionId);
    if (stamp !== account.credentialsStamp) throw fail();
    const member = await this.repository.lockMember(tx, subject.userId);
    if (member?.status !== 'active') throw fail();
    return member;
  }

  /** Штамп живой сессии сотрудника или `undefined` (чужая, отозвана, истекла по простою или сроку). */
  private async liveSessionStamp(
    tx: DbSession,
    userId: string,
    sessionId: string,
  ): Promise<string | undefined> {
    const session = await this.repository.findSession(tx, sessionId);
    const now = this.clock.now();
    const live =
      session?.userId === userId &&
      session.revokedAt === null &&
      session.idleExpiresAt > now &&
      session.expiresAt > now;
    return live ? session.credentialsStamp : undefined;
  }
}
