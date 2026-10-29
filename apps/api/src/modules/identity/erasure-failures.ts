import { Injectable } from '@nestjs/common';

import type { DbSession } from '../../db';
import { ERASURE_RETRY_COOLDOWN_MS, ERASURE_STUCK_MS } from './identity.policy';
import { type ErasurePendingDoc, IdentityRepository } from './identity.repository';

export type ErasurePending = ErasurePendingDoc;

/** Исход захвата повтора: поставлен / уже запрошен недавно / не зависшее удаление (нет, живой, завершено, рано). */
export type ErasureRetryClaim = 'claimed' | 'recent' | 'not_found' | 'not_pending';

/**
 * Порт `identity` для экрана сбоев удаления панели (erasure-failures, модуль `account`, только admin): зависшие
 * удаления — порог `ERASURE_STUCK_MS`, как у карточки «Обзора», — и захват повтора в транзакции действия. Только
 * служебные поля, без e-mail.
 */
@Injectable()
export class ErasureFailures {
  constructor(private readonly repository: IdentityRepository) {}

  page(
    now: Date,
    after: { deletedAt: Date; id: string } | null,
    limit: number,
  ): Promise<ErasurePending[]> {
    return this.repository.pendingSweepPage(stuckBefore(now), after, limit);
  }

  async claimRetry(session: DbSession, userId: string, now: Date): Promise<ErasureRetryClaim> {
    const retryBefore = new Date(now.getTime() - ERASURE_RETRY_COOLDOWN_MS);
    if (
      await this.repository.claimErasureRetry(session, userId, stuckBefore(now), retryBefore, now)
    ) {
      return 'claimed';
    }
    const state = await this.repository.deletionState(userId);
    if (!state?.deletedAt) return 'not_found';
    if (state.erasureSweptAt || state.deletedAt >= stuckBefore(now)) return 'not_pending';
    return 'recent';
  }
}

const stuckBefore = (now: Date) => new Date(now.getTime() - ERASURE_STUCK_MS);
