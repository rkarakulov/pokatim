import { Injectable } from '@nestjs/common';

import type { DbSession } from '../../db';
import { domainError } from '../../error-messages';
import { CredentialsCheck } from './credentials-check';
import { IdentityRepository } from './identity.repository';

export type AccountCloseOutcome = 'closed' | 'already' | 'changed';

/**
 * Порт identity для удаления аккаунта (модуль `account`, ADR-0015): подтверждение текущим паролем и закрытие аккаунта
 * в транзакции вызывающего. Документы identity пишет только identity.
 */
@Injectable()
export class AccountClosure {
  constructor(
    private readonly credentials: CredentialsCheck,
    private readonly repository: IdentityRepository,
  ) {}

  /**
   * Текущий пароль аккаунта — та же `CredentialsCheck`, что у входа (общие счётчики `signin-*` по e-mail аккаунта и
   * IP, A2; 429 — как у входа). Аккаунта нет, удалён или стёрт — `401 UNAUTHORIZED`; неверный пароль —
   * `403 PASSWORD_INCORRECT` (не 401: клиент не уходит в refresh и выход). Возвращает проверенный хеш — для сверки в
   * `close`; наружу и в логи он не уходит.
   */
  async verifyPassword(userId: string, password: string, ip: string): Promise<string> {
    const account = await this.repository.findCredentialsById(userId);
    if (!account || account.deletedAt) throw domainError('UNAUTHORIZED', 401);
    const checked = await this.credentials.verify({ email: account.email, password }, ip);
    if (!checked || checked.id !== userId) throw domainError('PASSWORD_INCORRECT', 403);
    return checked.passwordHash;
  }

  /**
   * Закрытие аккаунта в транзакции вызывающего: **первой** операцией `lockUserCredentials` (R1), затем `deletedAt`,
   * отзыв всех сессий (`account_deleted`), гашение активных ссылок подтверждения и сброса и токена регистрации.
   * `already` — удалён параллельным запросом (или учётных данных уже нет); `changed` — пароль сменили после проверки
   * (сброс между проверкой и транзакцией; он же отозвал все сессии) — ничего не меняется.
   */
  async close(
    tx: DbSession,
    userId: string,
    checkedHash: string,
    now: Date,
  ): Promise<{ outcome: AccountCloseOutcome; revoked: number }> {
    const user = await this.repository.lockUserCredentials(tx, userId);
    if (!user || user.deletedAt) return { outcome: 'already', revoked: 0 };
    if (user.passwordHash !== checkedHash) return { outcome: 'changed', revoked: 0 };

    await this.repository.markDeleted(tx, userId, now);
    const revoked = await this.repository.revokeAllSessions(tx, userId, now, 'account_deleted');
    await this.repository.supersedeActiveVerificationTokens(tx, userId, now);
    await this.repository.supersedeActivePasswordResetTokens(tx, userId, now);
    await this.repository.revokeRegistrationToken(tx, userId, now);
    return { outcome: 'closed', revoked };
  }
}
