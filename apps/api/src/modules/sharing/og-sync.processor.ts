import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { QUEUE } from '../../queues';
import { OgSync, type OgSyncRun } from './og-sync';

export const OG_SYNC_JOB = 'sync';

/**
 * Без ретраев и без хранения итогов (ревью F3): следующий прогон через минуту и так повторит, а failed-набор с
 * умолчаниями очередей (`removeOnFail: false`) копил бы задачу в минуту.
 */
const ONE_SHOT = { attempts: 1, removeOnComplete: true, removeOnFail: true } as const;
/** Разовая задача без дублей (jobId): прогон при старте worker — картинки после выката ставятся сразу. */
export const OG_SYNC_BOOT_JOB_ID = 'og.sync.boot';

/** Расписание пререндера OG-картинок; upsert идемпотентен — несколько worker не плодят дубли. */
export const OG_SCHEDULES = [
  {
    id: 'og.sync',
    repeat: { pattern: '* * * * *', tz: 'Europe/Minsk' },
    job: { name: OG_SYNC_JOB, opts: ONE_SHOT },
  },
] as const;

/**
 * Регламент OG-картинок (`og-sync`, og-images, DV-1): каждую минуту и при старте worker — `OgSync.run` (постановка
 * рендера изменившихся публичных объектов). Сбой вида — задача падает (failed-набор BullMQ), следующий прогон повторяет.
 */
@Processor(QUEUE.ogSync)
export class OgSyncProcessor extends WorkerHost {
  constructor(private readonly sync: OgSync) {
    super();
  }

  async process(job: Job): Promise<OgSyncRun> {
    if (job.name !== OG_SYNC_JOB) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.ogSync}`);
    }
    return this.sync.run();
  }
}

@Injectable()
export class OgSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.ogSync) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of OG_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
    await this.queue.add(OG_SYNC_JOB, {}, { jobId: OG_SYNC_BOOT_JOB_ID, ...ONE_SHOT });
  }
}
