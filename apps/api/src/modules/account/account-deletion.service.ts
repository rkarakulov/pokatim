import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DeleteAccountRequest, RateLimitedDetails } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { AccountClosure } from '../identity';
import { PushTokens } from '../notifications';
import { PanelAudit, PanelMembership } from '../panel';
import { riderSubjectLabel } from '../profile';
import { ACCOUNT_DELETION_REQUESTED, type AccountDeletionRequested } from './account.events';
import { ACCOUNT_POLICY } from './account.policy';

/**
 * Удаление своего аккаунта (A1, A2, A11; ADR-0015). Порядок: лимит по пользователю → член команды панели (A11, до
 * пароля: заведомый отказ не расходует счётчики входа) → пароль (`AccountClosure.verifyPassword`, общие счётчики входа)
 * → одна транзакция: закрытие аккаунта identity, журнал панели `account.deleted`, снятие push-токенов
 * (`PushTokens`), outbox очистки. Фоновая очистка —
 * worker (`AccountErasureService`).
 *
 * Гонка «проверка роли ↔ выдача роли» принята (R7, F12): документы разные, общего замка нет; итог — роль у
 * удалённого: гард панели его не пускает, «Сотрудники» показывают «Удалённый участник», админ снимает роль.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly closure: AccountClosure,
    private readonly membership: PanelMembership,
    private readonly audit: PanelAudit,
    private readonly pushTokens: PushTokens,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async delete(userId: string, body: DeleteAccountRequest, ip: string): Promise<void> {
    const limited = await this.rateLimiter.consume(
      `account-delete:${userId}`,
      ACCOUNT_POLICY.deleteLimit,
      this.clock.now(),
    );
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    if (await this.membership.hasActiveRole(userId)) {
      throw domainError('ACCOUNT_PANEL_MEMBER', 409);
    }
    const checkedHash = await this.closure.verifyPassword(userId, body.password, ip);

    const now = this.clock.now();
    const result = await this.transactions.run(async (tx) => {
      const closed = await this.closure.close(tx, userId, checkedHash, now);
      if (closed.outcome !== 'closed') return closed;
      await this.audit.append(tx, {
        action: 'account.deleted',
        actor: { kind: 'user', userId },
        subject: { kind: 'rider', id: userId, label: riderSubjectLabel(userId) },
      });
      // push перестают уходить сразу (N11, ADR-0017): токены — в той же транзакции, откат оставляет их
      await this.pushTokens.revokeAllOf(tx, userId);
      const payload: AccountDeletionRequested = { userId };
      await this.outbox.append(tx, { type: ACCOUNT_DELETION_REQUESTED, payload });
      return closed;
    });

    // пароль сменили между проверкой и транзакцией: сброс уже отозвал все сессии — как истёкшая сессия
    if (result.outcome === 'changed') throw domainError('UNAUTHORIZED', 401);
    // только id, исход и число сессий: ни e-mail, ни пароля, ни хеша
    this.logger.log(
      `account.deleted user=${userId} outcome=${result.outcome} sessions=${result.revoked}`,
    );
  }
}
