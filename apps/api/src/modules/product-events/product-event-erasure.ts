import { Injectable } from '@nestjs/common';

import { ProductEventsRepository } from './product-events.repository';

/**
 * Порт стирания журнала продуктовых событий (модуль `account`, шаг `product-events`, K13): `deleteMany({ userId })`.
 * Повторяемо; события, записанные после первого прохода, убирает повторный.
 */
@Injectable()
export class ProductEventErasure {
  constructor(private readonly repository: ProductEventsRepository) {}

  erase(userId: string): Promise<number> {
    return this.repository.deleteAllOf(userId);
  }
}
