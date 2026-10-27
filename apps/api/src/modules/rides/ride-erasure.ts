import { Injectable } from '@nestjs/common';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { RIDES_RIDE_CANCELLED, type RideEventPayload } from './rides.events';
import { RidesRepository } from './rides.repository';

export interface RideErasureResult {
  cancelled: number;
  left: number;
  unsigned: number;
}

/**
 * Порт стирания кофе-райдов удалённого аккаунта (модуль `account`, ADR-0015, A6): будущие свои — отменены
 * («Организатор не сможет»; скрытые — в `hiddenFromStatus`), отметки в чужих будущих сняты, подпись организатора
 * стёрта во всех его райдах. Прошедшие чужие с отметкой и жалобы на райды не трогаются (A6). Повторяемо.
 * Отмена опубликованного — по одному райду: та же условная операция, что у организатора, в транзакции с событием
 * `rides.ride-cancelled` (ADR-0016); повтор фильтр не проходит — второго события нет. Скрытые — без события (RC-8).
 */
@Injectable()
export class RideErasure {
  constructor(
    private readonly repository: RidesRepository,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
  ) {}

  async erase(userId: string, now: Date): Promise<RideErasureResult> {
    let cancelled = 0;
    for (const rideId of await this.repository.futurePublishedIdsOf(userId, now)) {
      if (await this.cancelOne(userId, rideId, now)) cancelled += 1;
    }
    cancelled += await this.repository.cancelHiddenFutureOf(userId, now);
    const left = await this.repository.leaveAllFuture(userId, now);
    const unsigned = await this.repository.clearOrganizerName(userId, now);
    return { cancelled, left, unsigned };
  }

  private cancelOne(userId: string, rideId: string, now: Date): Promise<boolean> {
    return this.transactions.run(async (tx) => {
      const doc = await this.repository.cancel(rideId, userId, 'organizer_unavailable', now, tx);
      if (!doc) return false;
      const payload: RideEventPayload = { rideId };
      await this.outbox.append(tx, { type: RIDES_RIDE_CANCELLED, payload });
      return true;
    });
  }
}
