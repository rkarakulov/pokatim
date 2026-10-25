import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { TRACK_FILE_STORE, type TrackFileStore } from './track-file-store';
import { TrackSourcesService } from './track-sources.service';
import { TRACKS_POLICY } from './tracks.policy';
import { TracksRepository } from './tracks.repository';

export const TRACKS_CLEANUP_JOB = 'cleanup';

/** Расписание регламента треков; upsert идемпотентен — несколько worker не плодят дубли. */
export const TRACKS_SCHEDULES = [
  {
    id: 'tracks.cleanup.hourly',
    repeat: { pattern: '17 * * * *', tz: 'Europe/Minsk' },
    job: { name: TRACKS_CLEANUP_JOB },
  },
] as const;

export interface TracksCleanupResult {
  rejectedFiles: number;
  orphanFiles: number;
}

/**
 * Уборка хранилища (ежечасно, Q10): исходники отбракованных загрузок (`failed`/`skipped`/`duplicate`) старше 7 дней
 * и файлы без документа старше 1 ч (сбой между записью файла и транзакцией, удаление загрузки без удаления файла).
 * Идемпотентна; лог — только счётчики.
 */
@Processor(QUEUE.tracksMaintenance)
export class TracksMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(TracksMaintenanceProcessor.name);

  constructor(
    private readonly repository: TracksRepository,
    private readonly sources: TrackSourcesService,
    @Inject(TRACK_FILE_STORE) private readonly files: TrackFileStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job): Promise<TracksCleanupResult> {
    if (job.name !== TRACKS_CLEANUP_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.tracksMaintenance}`);
    }
    return this.cleanup();
  }

  async cleanup(): Promise<TracksCleanupResult> {
    const now = this.clock.now().getTime();
    let rejectedFiles = 0;
    const before = new Date(now - TRACKS_POLICY.rejectedRetentionMs);
    for (;;) {
      const batch = await this.repository.rejectedWithFile(before, TRACKS_POLICY.cleanupBatchSize);
      for (const upload of batch) {
        if (!upload.storageKey) continue;
        await this.files.delete(upload.storageKey);
        await this.repository.clearStorageKey(upload._id, upload.storageKey);
        rejectedFiles += 1;
      }
      if (batch.length < TRACKS_POLICY.cleanupBatchSize) break;
    }

    let orphanFiles = 0;
    let pending: { key: string }[] = [];
    const flush = async () => {
      const known = await this.repository.knownStorageKeys(pending.map((file) => file.key));
      for (const file of pending) {
        if (known.has(file.key)) continue;
        await this.files.deleteListed(file.key);
        orphanFiles += 1;
      }
      pending = [];
    };
    for await (const file of this.files.list()) {
      if (now - file.modifiedAt.getTime() < TRACKS_POLICY.orphanFileAgeMs) continue;
      pending.push(file);
      if (pending.length >= TRACKS_POLICY.cleanupBatchSize) await flush();
    }
    await flush();

    if (rejectedFiles + orphanFiles > 0) await this.sources.invalidateUsage();
    this.logger.log(`cleanup: ${rejectedFiles} rejected files, ${orphanFiles} orphan files`);
    return { rejectedFiles, orphanFiles };
  }
}

@Injectable()
export class TracksSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.tracksMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of TRACKS_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
  }
}
