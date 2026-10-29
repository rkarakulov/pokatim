import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AccountErasurePage,
  type AccountErasureQuery,
  ErasureStep,
  type RetryAccountErasureRequest,
  type RetryAccountErasureResult,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { type ErasurePending, ErasureFailures } from '../identity';
import { PanelAudit } from '../panel';
import { riderSubjectLabel } from '../profile';
import {
  ACCOUNT_ERASURE_RETRY_REQUESTED,
  type AccountErasureRetryRequested,
} from './account.events';

const CursorKey = z.iso.datetime();

/** Шаг из документа — по справочнику контракта; незнакомый (старая запись) не роняет страницу. */
const stepOf = (step: string) => {
  const parsed = ErasureStep.safeParse(step);
  return parsed.success ? parsed.data : null;
};

const toRow = (doc: ErasurePending): AccountErasurePage['items'][number] => {
  const failure = doc.erasureLastFailure;
  const step = failure ? stepOf(failure.step) : null;
  return {
    userId: doc._id,
    deletedAt: doc.deletedAt.toISOString(),
    failedAttempts: doc.erasureFailedAttempts ?? 0,
    lastFailure:
      failure && step ? { step, code: failure.code, at: failure.at.toISOString() } : null,
    retryRequestedAt: doc.erasureRetryRequestedAt?.toISOString() ?? null,
  };
};

/**
 * Сбои удаления аккаунтов в панели (erasure-failures, `platform.stats` — только admin): зависшие удаления (порог
 * «Обзора») и «Повторить удаление». Повтор — одна транзакция: захват `ErasureFailures.claimRetry` → журнал
 * `account.erasure_retried` (подпись `Участник ·<id>`, причина) → outbox повторного прохода; уже запрошен недавно —
 * `{ queued: false }` без журнала. Ни e-mail, ни имени — ни в ответе, ни в журнале, ни в логе.
 */
@Injectable()
export class AccountErasuresAdminService {
  private readonly logger = new Logger(AccountErasuresAdminService.name);

  constructor(
    private readonly failures: ErasureFailures,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: AccountErasureQuery): Promise<AccountErasurePage> {
    const cursor = query.cursor ? decodeCursor(query.cursor, CursorKey) : null;
    const after = cursor ? { deletedAt: new Date(cursor.k), id: cursor.id } : null;
    const docs = await this.failures.page(this.clock.now(), after, query.limit + 1);
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toRow),
      nextCursor:
        docs.length > query.limit && last
          ? encodeCursor(last.deletedAt.toISOString(), last._id)
          : null,
    };
  }

  async retry(
    actorUserId: string,
    userId: string,
    body: RetryAccountErasureRequest,
  ): Promise<RetryAccountErasureResult> {
    const now = this.clock.now();
    const claim = await this.transactions.run(async (tx) => {
      const outcome = await this.failures.claimRetry(tx, userId, now);
      if (outcome !== 'claimed') return outcome;
      await this.audit.append(tx, {
        action: 'account.erasure_retried',
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'rider', id: userId, label: riderSubjectLabel(userId) },
        reason: body.reason,
      });
      const payload: AccountErasureRetryRequested = { userId };
      await this.outbox.append(tx, { type: ACCOUNT_ERASURE_RETRY_REQUESTED, payload });
      return outcome;
    });
    if (claim === 'not_found') throw domainError('NOT_FOUND', 404);
    if (claim === 'not_pending') throw domainError('CONFLICT', 409);
    this.logger.log(`account.erasure_retry user=${userId} by=${actorUserId} outcome=${claim}`);
    return { queued: claim === 'claimed' };
  }
}
