import { Injectable } from '@nestjs/common';

import { RouteRidesRepository } from './route-rides.repository';

/**
 * Порт стирания заездов по маршруту удалённого аккаунта (модуль `account`, ADR-0015): все заезды пользователя одной
 * операцией. Повторяемо (повтор — 0).
 */
@Injectable()
export class RouteRideErasure {
  constructor(private readonly repository: RouteRidesRepository) {}

  erase(userId: string): Promise<number> {
    return this.repository.deleteAllOf(userId);
  }
}
