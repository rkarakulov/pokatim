import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, MAILER, type Mailer } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { type DeletionState, IdentityRepository } from './identity.repository';
import { renderAccountDeletedEmail } from './mail/account-deleted-email';
import { erasedEmailMarker } from './tokens';

export type AccountEraseOutcome = 'erased' | 'already' | 'not_deleted';

/** Сроки шага identity; задаёт оркестратор (`ACCOUNT_POLICY`). */
export interface AccountEraseOptions {
  /** Письмо не ушло за этот срок после удаления — стирание без письма (F8). */
  abandonEmailAfterMs: number;
  /** Срок захвата отправки письма: упавший worker не блокирует ретрай навсегда. */
  emailClaimMs: number;
}

/**
 * Порт identity для фоновой очистки удалённого аккаунта (worker, модуль `account`, ADR-0015): письмо «Аккаунт удалён»
 * (A10) и стирание ПДн (A4). Каждый метод повторяем: условия — в фильтрах, маркеры — в документе. Логи — только uid.
 */
@Injectable()
export class AccountErasure {
  private readonly logger = new Logger(AccountErasure.name);

  constructor(
    private readonly repository: IdentityRepository,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET' | 'SUPPORT_EMAIL'>,
  ) {}

  deletionState(userId: string): Promise<DeletionState | undefined> {
    return this.repository.deletionState(userId);
  }

  /**
   * Письмо (захват → отправка → отметка), затем стирание `email` (маркер), `birthDate`, `passwordHash` и `erasedAt`.
   * Сбой SMTP — захват снят, бросок (ретрай задачи); живой чужой захват — бросок (ретрай позже). Падение между
   * отправкой и отметкой даёт второе письмо после истечения захвата (at-least-once, R6). Письмо не ушло за
   * `abandonEmailAfterMs` — стирание без письма (лог `account.deletion_email_abandoned`).
   */
  async notifyAndErase(
    userId: string,
    now: Date,
    options: AccountEraseOptions,
  ): Promise<AccountEraseOutcome> {
    const state = await this.repository.deletionState(userId);
    if (!state?.deletedAt) return 'not_deleted';
    if (state.erasedAt) return 'already';

    const abandonBefore = new Date(now.getTime() - options.abandonEmailAfterMs);
    if (!state.deletionEmailSentAt) {
      if (state.deletedAt < abandonBefore) {
        this.logger.warn(`account.deletion_email_abandoned user=${userId}`);
      } else {
        await this.sendDeletionEmail(userId, now, options.emailClaimMs);
      }
    }

    const email = await this.repository.openEmailOfDeleted(userId);
    if (email === undefined) return 'already';
    const erased = await this.repository.eraseDeleted(userId, {
      email,
      marker: erasedEmailMarker(this.env.EMAIL_TOKEN_SECRET, email),
      now,
      abandonBefore,
    });
    if (erased) return 'erased';
    const after = await this.repository.deletionState(userId);
    if (after?.erasedAt) return 'already';
    throw new Error(`account erasure did not apply for user ${userId}`);
  }

  markSwept(userId: string, now: Date): Promise<void> {
    return this.repository.markErasureSwept(userId, now);
  }

  pendingSweeps(deletedBefore: Date, limit: number): Promise<string[]> {
    return this.repository.pendingSweeps(deletedBefore, limit);
  }

  private async sendDeletionEmail(userId: string, now: Date, leaseMs: number): Promise<void> {
    const claim = await this.repository.claimDeletionEmail(userId, now, leaseMs);
    if (!claim) return;
    if (claim.status === 'busy') {
      throw new Error(`account deletion email is being sent by another worker, user ${userId}`);
    }
    try {
      await this.mailer.send({
        to: claim.email,
        ...renderAccountDeletedEmail({
          deletedAt: claim.deletedAt,
          supportEmail: this.env.SUPPORT_EMAIL,
        }),
      });
    } catch (error) {
      await this.repository.releaseDeletionEmail(userId, now);
      throw error;
    }
    await this.repository.completeDeletionEmail(userId, now, now);
    this.logger.log(`account.deletion_email_sent user=${userId}`);
  }
}
