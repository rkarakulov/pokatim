import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import type { ActivityTotals, ActivityTotalsResult } from './activity-totals.port';
import { tracksCollections } from './tracks.collection';

/**
 * Реализация порта `ActivityTotals` (rider-profile): одно чтение-агрегация по `activities` (индекс
 * `activities_user_started_idx` по `userId`, документы активностей маленькие — линия в `activity_tracks`). Только
 * чтение: писатель коллекции — `TracksRepository`.
 */
@Injectable()
export class ActivityTotalsService implements ActivityTotals {
  private readonly activities;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.activities = tracksCollections(db).activities;
  }

  async of(userId: string): Promise<ActivityTotalsResult> {
    const [row] = await this.activities
      .aggregate<ActivityTotalsResult>([
        { $match: { userId, duplicateOf: null, sport: { $ne: 'other' } } },
        {
          $group: {
            _id: null,
            activities: { $sum: 1 },
            distanceM: { $sum: '$distanceM' },
            elevationGainM: { $sum: { $ifNull: ['$elevationGainM', 0] } },
          },
        },
        { $project: { _id: 0, activities: 1, distanceM: 1, elevationGainM: 1 } },
      ])
      .toArray();
    return row ?? { activities: 0, distanceM: 0, elevationGainM: 0 };
  }
}
