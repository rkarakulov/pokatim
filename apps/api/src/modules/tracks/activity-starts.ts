import { Injectable } from '@nestjs/common';

import type { ActivityStart, ActivityStarts } from './activity-starts.port';
import { TracksRepository } from './tracks.repository';

/**
 * Реализация порта `ActivityStarts` (P5, RC-P5-2): два чтения через `TracksRepository` — активность, затем её
 * основная (`duplicateOf ?? _id`). Хранимое `duplicateOf` — авторитетная основная группы, сортировка группы не нужна.
 */
@Injectable()
export class ActivityStartsService implements ActivityStarts {
  constructor(private readonly repository: TracksRepository) {}

  async primaryStart(activityId: string): Promise<ActivityStart | null> {
    const activity = await this.repository.findActivity(activityId);
    if (!activity) return null;
    const primary =
      activity.duplicateOf === null
        ? activity
        : await this.repository.findActivity(activity.duplicateOf);
    if (!primary) return null;
    return {
      activityId: primary._id,
      userId: primary.userId,
      sport: primary.sport,
      startedAt: primary.startedAt,
      startPoint: primary.startPoint.coordinates,
    };
  }
}
