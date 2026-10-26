import { Inject, Injectable } from '@nestjs/common';
import type { TrackFailureCode, TrackFormat, TrackUploadStatus } from '@pokatim/contracts';
import { boundsOf, type Bounds } from '@pokatim/tracks';

import type { DbSession } from '../../db';
import type { ActivityRef, ActivitySource, UploadState } from './activity-source.port';
import { TRACK_FILE_STORE, type TrackFileStore } from './track-file-store';
import type { ActivityDoc } from './tracks.collection';
import { byPrimaryPriority } from './tracks.policy';
import { TracksRepository } from './tracks.repository';

/** Реализация порта `ActivitySource`: читает только через `TracksRepository`, файл — через `TrackFileStore`. */
@Injectable()
export class ActivitySourceService implements ActivitySource {
  constructor(
    private readonly repository: TracksRepository,
    @Inject(TRACK_FILE_STORE) private readonly files: TrackFileStore,
  ) {}

  async group(
    activityId: string,
    tx?: DbSession,
  ): Promise<{ userId: string; members: ActivityRef[] } | null> {
    const activity = await this.repository.findActivity(activityId, tx);
    if (!activity) return null;
    const root = activity.duplicateOf ?? activity._id;
    const members = byPrimaryPriority(
      await this.repository.groupMembers(tx, activity.userId, [root]),
    );
    return { userId: activity.userId, members: await this.refs(members, tx) };
  }

  async activity(userId: string, activityId: string, tx?: DbSession): Promise<ActivityRef | null> {
    const activity = await this.repository.findActivity(activityId, tx);
    if (!activity || activity.userId !== userId) return null;
    return (await this.refs([activity], tx))[0] ?? null;
  }

  async uploadState(userId: string, uploadId: string, tx?: DbSession): Promise<UploadState | null> {
    const upload = await this.repository.findOwnUpload(userId, uploadId, tx);
    if (!upload) return null;
    const activity = upload.activityId
      ? await this.repository.findActivity(upload.activityId, tx)
      : undefined;
    return {
      status: upload.status,
      failure: upload.failure,
      createdAt: upload.createdAt,
      activity: activity ? ((await this.refs([activity], tx))[0] ?? null) : null,
    };
  }

  async uploadStates(
    userId: string,
    uploadIds: readonly string[],
  ): Promise<Map<string, { status: TrackUploadStatus; failure: TrackFailureCode | null }>> {
    const uploads = await this.repository.ownUploadsByIds(userId, uploadIds);
    return new Map(
      uploads.map((upload) => [upload._id, { status: upload.status, failure: upload.failure }]),
    );
  }

  async listInRange(userId: string, from: Date, to: Date, limit: number): Promise<ActivityRef[]> {
    return this.refs(await this.repository.primaryActivitiesInRange(userId, from, to, limit));
  }

  async readSource(activityId: string): Promise<{ bytes: Uint8Array; format: TrackFormat } | null> {
    const activity = await this.repository.findActivity(activityId);
    const upload = activity ? await this.repository.findUpload(activity.uploadId) : undefined;
    if (!upload?.storageKey) return null;
    try {
      return { bytes: await this.files.get(upload.storageKey), format: upload.format };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Сводки активностей с временем приёма файла и рамкой линии (одним запросом на коллекцию). */
  private async refs(activities: readonly ActivityDoc[], tx?: DbSession): Promise<ActivityRef[]> {
    if (activities.length === 0) return [];
    // по очереди: операции одной сессии транзакции не выполняются параллельно
    const uploads = await this.repository.uploadsByIds(
      activities.map((activity) => activity.uploadId),
      tx,
    );
    const lines = await this.repository.trackLines(
      activities.map((activity) => activity._id),
      tx,
    );
    const uploadCreatedAt = new Map(uploads.map((upload) => [upload._id, upload.createdAt]));
    return activities.flatMap((activity): ActivityRef[] => {
      const createdAt = uploadCreatedAt.get(activity.uploadId);
      if (!createdAt) return [];
      const [lon, lat] = activity.startPoint.coordinates;
      const start: Bounds = [lon, lat, lon, lat];
      return [
        {
          id: activity._id,
          userId: activity.userId,
          uploadId: activity.uploadId,
          uploadCreatedAt: createdAt,
          isPrimary: activity.duplicateOf === null,
          primaryId: activity.duplicateOf ?? activity._id,
          sport: activity.sport,
          source: activity.source,
          startedAt: activity.startedAt,
          endedAt: activity.endedAt,
          elapsedSec: activity.elapsedSec,
          distanceM: activity.distanceM,
          bounds: boundsOf(lines.get(activity._id) ?? []) ?? start,
        },
      ];
    });
  }
}
