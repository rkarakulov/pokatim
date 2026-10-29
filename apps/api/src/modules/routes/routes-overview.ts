import { Injectable } from '@nestjs/common';

import { RoutesRepository } from './routes.repository';

/**
 * Порт `routes` для «Обзора» панели (admin-overview, модуль `overview`): размеры очередей «Маршрутов райдеров» —
 * «На проверке» и «Жалобы» (те же фильтры и индексы, что у списков раздела). Только чтение.
 */
@Injectable()
export class RoutesOverview {
  constructor(private readonly repository: RoutesRepository) {}

  async moderationCounts(): Promise<{ pending: number; reported: number }> {
    const [pending, reported] = await Promise.all([
      this.repository.countPublicationQueue('pending'),
      this.repository.countPublicationQueue('reported'),
    ]);
    return { pending, reported };
  }
}
