import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import { disputesCollections } from './disputes.collection';

/**
 * Порт `disputes` для «Обзора» панели (admin-overview, модуль `overview`): открытые споры — та же очередь, что
 * «Споры» (`status: 'open'`, индекс `disputes_queue_idx`). Только чтение.
 */
@Injectable()
export class DisputesOverview {
  private readonly disputes;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.disputes = disputesCollections(db).disputes;
  }

  openCount(): Promise<number> {
    return this.disputes.countDocuments({ status: 'open' });
  }
}
