import { Injectable } from '@nestjs/common';

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
 */
@Injectable()
export class RideErasure {
  constructor(private readonly repository: RidesRepository) {}

  async erase(userId: string, now: Date): Promise<RideErasureResult> {
    const cancelled =
      (await this.repository.cancelFutureOf(userId, now)) +
      (await this.repository.cancelHiddenFutureOf(userId, now));
    const left = await this.repository.leaveAllFuture(userId, now);
    const unsigned = await this.repository.clearOrganizerName(userId, now);
    return { cancelled, left, unsigned };
  }
}
