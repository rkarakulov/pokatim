import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import { ridesCollections } from './rides.collection';

/**
 * Порт `rides` для «Обзора» панели (admin-overview, модуль `overview`). Фильтры — те же, что у очереди «Открытые
 * жалобы» (`listReported`, частичный `rides_report_queue_idx`) и у ленты (фаза `upcoming`: `published`, старт
 * впереди, `rides_feed_idx`). Только чтение.
 */
@Injectable()
export class RidesOverview {
  private readonly rides;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.rides = ridesCollections(db).rides;
  }

  /** Райды с открытыми жалобами — элементы очереди «Модерации райдов». */
  reportedCount(): Promise<number> {
    return this.rides.countDocuments({ openReportCount: { $gt: 0 } });
  }

  /** Активные райды: опубликованные, старт после `now`. */
  upcomingCount(now: Date): Promise<number> {
    return this.rides.countDocuments({ status: 'published', startsAt: { $gt: now } });
  }
}
