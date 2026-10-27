import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';

import { DeviceAudit } from './device-audit';
import { DevicesLocks, pullLockKey } from './devices-jobs';
import type { DeviceConnectionDoc } from './devices.collection';
import { DEVICES_POLICY } from './devices.policy';
import { DevicesRepository, type RevokedReason } from './devices.repository';
import {
  AggregatorError,
  WEARABLES_AGGREGATOR,
  type WearablesAggregator,
} from './wearables-aggregator';

/** Попытка задачи: последняя — финальный провал виден (`revokeFailed` + журнал), а не только в очереди. */
export interface Attempt {
  final: boolean;
}

/** Замок подключения держит текущий pull дольше ожидания отзыва: задача отзыва повторится с экспонентой. */
export class RevokeBusyError extends Error {
  constructor() {
    super('revoke will be retried: connection lock is busy');
    this.name = 'RevokeBusyError';
  }
}

/**
 * Общий отзыв подключения в агрегаторе — для задачи `devices.revoke-requested` (`DevicesSyncService`) и стирания
 * аккаунта (`DeviceErasure`): замок `devices:pull:<id>` (ждёт текущий импорт), `revokeConnection` (`not_found` —
 * успех в адаптере), повторяемый сбой не на финале — бросок (ретрай), иначе `revoked` + `revokeFailed` и журнал.
 */
@Injectable()
export class DeviceRevocation {
  private readonly logger = new Logger(DeviceRevocation.name);

  constructor(
    private readonly repository: DevicesRepository,
    private readonly audit: DeviceAudit,
    private readonly transactions: MongoTransactions,
    private readonly locks: DevicesLocks,
    @Inject(WEARABLES_AGGREGATOR) private readonly aggregator: WearablesAggregator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Под замком подключения; занят дольше ожидания — `RevokeBusyError`. */
  async locked<T>(connectionId: string, attempt: Attempt, work: () => Promise<T>): Promise<T> {
    const key = pullLockKey(connectionId);
    // последняя попытка ждёт весь TTL замка pull: он истекает сам, отзыв не застревает в `disconnecting`
    const waitMs = attempt.final ? DEVICES_POLICY.pullLockTtlMs : DEVICES_POLICY.revokeLockWaitMs;
    const token = await this.locks.acquire(key, DEVICES_POLICY.pullLockTtlMs, waitMs);
    if (!token) throw new RevokeBusyError();
    try {
      return await work();
    } finally {
      await this.locks.release(key, token);
    }
  }

  /**
   * Отзыв `disconnecting` подключения (под замком вызывающего): агрегатор → `beforeFinish` (удаление загрузок по
   * галочке) → `revoked` из `disconnecting`; неудачный отзыв — `revokeFailed` и запись журнала `revoke_failed`.
   */
  async revokeDisconnecting(
    connection: DeviceConnectionDoc,
    reason: RevokedReason,
    attempt: Attempt,
    beforeFinish?: () => Promise<void>,
  ): Promise<'revoked' | 'revoke_failed'> {
    let failed = false;
    try {
      await this.aggregator.revokeConnection(connection.aggUserId, connection.provider);
    } catch (error) {
      const retryable = !(error instanceof AggregatorError) || error.retryable;
      if (retryable && !attempt.final) throw error;
      failed = true;
      const kind = error instanceof AggregatorError ? error.kind : 'error';
      this.logger.warn(`devices.revoke_failed connection=${connection._id} reason=${kind}`);
    }
    await beforeFinish?.();
    const now = this.clock.now();
    await this.transactions.run(async (session) => {
      const updated = await this.repository.markRevoked(session, connection._id, 'disconnecting', {
        reason,
        revokeFailed: failed,
        now,
      });
      if (updated && failed) {
        await this.audit.append(session, {
          userId: connection.userId,
          provider: connection.provider,
          connectionId: connection._id,
          action: 'revoke_failed',
          reason,
        });
      }
    });
    this.logger.log(`devices.revoked connection=${connection._id} failed=${failed}`);
    return failed ? 'revoke_failed' : 'revoked';
  }
}
