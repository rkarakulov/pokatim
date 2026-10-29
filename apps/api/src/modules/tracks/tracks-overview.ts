import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import { tracksCollections } from './tracks.collection';

/**
 * Порт `tracks` для «Обзора» панели (admin-overview, модуль `overview`, KPI admin): загрузки заездов за период —
 * файлы и потоки агрегатора (`track_uploads`, индекс `track_uploads_created_at_idx`, 0036). Только чтение.
 */
@Injectable()
export class TracksOverview {
  private readonly uploads;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.uploads = tracksCollections(db).uploads;
  }

  uploadsSince(since: Date): Promise<number> {
    return this.uploads.countDocuments({ createdAt: { $gte: since } });
  }
}
