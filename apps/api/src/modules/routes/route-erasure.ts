import { Injectable } from '@nestjs/common';

import { MongoTransactions } from '../../db';
import { RoutesRepository } from './routes.repository';

/**
 * Порт стирания «Моих маршрутов» удалённого аккаунта (модуль `account`, ADR-0015, A7): каждый свой маршрут
 * (`origin: 'rider'`) — каскадом `deleteOwn` в своей транзакции, как удаление владельцем. Маршруты платформы фильтр не
 * видит. Повторяемо: удалённый маршрут в списке больше не появится.
 */
@Injectable()
export class RouteErasure {
  constructor(
    private readonly repository: RoutesRepository,
    private readonly transactions: MongoTransactions,
  ) {}

  async erase(userId: string): Promise<number> {
    let deleted = 0;
    for (const id of await this.repository.ownIds(userId)) {
      const removed = await this.transactions.run((tx) =>
        this.repository.deleteOwn(tx, userId, id),
      );
      if (removed) deleted += 1;
    }
    return deleted;
  }
}
