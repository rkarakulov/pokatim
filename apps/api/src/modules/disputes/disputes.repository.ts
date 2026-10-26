import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { type DisputeDoc, type DisputeEventDoc, disputesCollections } from './disputes.collection';

/**
 * Единственный писатель `disputes` и `dispute_events` (RC-8): спор — вставка и переходы только из `open` (фильтр
 * `status: 'open'`), без удалений и замен; история — только `insertOne` (сторож — `disputes.repository.test.ts`).
 * Значения фильтров — примитивы после zod.
 */
@Injectable()
export class DisputesRepository {
  private readonly disputes: Collection<DisputeDoc>;
  private readonly events: Collection<DisputeEventDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    const collections = disputesCollections(db);
    this.disputes = collections.disputes;
    this.events = collections.events;
  }

  // --- счётчики гейтов (индексы `disputes_target_idx`, `disputes_race_idx`) ---

  /** Открытые споры против заявки (D-39). */
  countOpenAgainst(entryId: string, session?: DbSession): Promise<number> {
    return this.disputes.countDocuments({ targetEntryId: entryId, status: 'open' }, { session });
  }

  /** Открытые споры гонки (чек-лист публикации, D-19). */
  countOpenInRace(raceId: string, session?: DbSession): Promise<number> {
    return this.disputes.countDocuments({ raceId, status: 'open' }, { session });
  }

  /** Открытые споры по гонкам страницы — одна агрегация; гонки без споров в карте отсутствуют. */
  async countOpenByRace(raceIds: readonly string[]): Promise<Map<string, number>> {
    if (raceIds.length === 0) return new Map();
    const rows = await this.disputes
      .aggregate<{ _id: string; count: number }>([
        { $match: { raceId: { $in: [...raceIds] }, status: 'open' } },
        { $group: { _id: '$raceId', count: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [row._id, row.count]));
  }
}
