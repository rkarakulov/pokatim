import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';

import { QUEUE } from '../../queues';
import { AchievementsReconciler } from './achievements-reconciler';
import {
  ACHIEVEMENTS_RIDER_JOB,
  ACHIEVEMENTS_SWEEP_JOB,
  AchievementsSweep,
  type AchievementsSweepRun,
} from './achievements-sweep';
import { ACHIEVEMENTS_SERVER_SYNC } from './achievements.policy';

export const ACHIEVEMENTS_SWEEP_BOOT_JOB_ID = 'achievements.sweep.boot';

/**
 * Прогон — одна попытка (следующий через минуту повторит), успешные не хранятся, провалы — в ограниченном
 * failed-наборе (видимость без задачи в минуту навсегда).
 */
const SWEEP_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: { count: 100 },
} as const;
/** Разовая задача без дублей (jobId): прогон при старте worker; не хранится — следующий старт поставит снова. */
const BOOT_JOB_OPTIONS = { attempts: 1, removeOnComplete: true, removeOnFail: true } as const;

/** Расписание серверной сверки; upsert идемпотентен — несколько worker не плодят дубли. */
export const ACHIEVEMENTS_SCHEDULES = [
  {
    id: ACHIEVEMENTS_SWEEP_JOB,
    repeat: { pattern: '* * * * *', tz: 'Europe/Minsk' },
    job: { name: ACHIEVEMENTS_SWEEP_JOB, opts: SWEEP_JOB_OPTIONS },
  },
] as const;

export const AchievementsRiderJob = z.object({ userId: z.string().min(1) });

export type AchievementsSyncOutcome = AchievementsSweepRun | 'reconciled';

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/**
 * Очередь `achievements-sync` (achievements-push N2): `achievements.sweep` — регламент `AchievementsSweep.run` (один
 * прогон за раз — замок в нём); `achievements.rider` — `reconcile(userId, 'server')` (центр + push). Последняя попытка
 * задачи райдера — лог `achievements.server_sync_failed uid=<uid>` и ошибка дальше (failed-набор BullMQ; экрана в панели
 * нет — follow-up).
 */
@Processor(QUEUE.achievementsSync, { concurrency: ACHIEVEMENTS_SERVER_SYNC.riderConcurrency })
export class AchievementsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(AchievementsSyncProcessor.name);

  constructor(
    private readonly sweep: AchievementsSweep,
    private readonly reconciler: AchievementsReconciler,
  ) {
    super();
  }

  async process(job: Job): Promise<AchievementsSyncOutcome> {
    switch (job.name) {
      case ACHIEVEMENTS_SWEEP_JOB:
        return this.sweep.run();
      case ACHIEVEMENTS_RIDER_JOB:
        return this.rider(job);
      default:
        throw new Error(`unknown job ${job.name} in queue ${QUEUE.achievementsSync}`);
    }
  }

  private async rider(job: Job): Promise<'reconciled'> {
    const { userId } = AchievementsRiderJob.parse(job.data);
    try {
      await this.reconciler.reconcile(userId, 'server');
      return 'reconciled';
    } catch (error) {
      if (isFinal(job)) {
        this.logger.error(
          `achievements.server_sync_failed uid=${userId} attempts=${job.attemptsMade + 1}`,
        );
      }
      throw error;
    }
  }
}

@Injectable()
export class AchievementsSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.achievementsSync) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of ACHIEVEMENTS_SCHEDULES) {
      await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
    }
    await this.queue.add(
      ACHIEVEMENTS_SWEEP_JOB,
      {},
      { jobId: ACHIEVEMENTS_SWEEP_BOOT_JOB_ID, ...BOOT_JOB_OPTIONS },
    );
  }
}
