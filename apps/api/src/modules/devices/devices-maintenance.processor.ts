import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CLOCK, type Clock, ENV } from '@rkarakulov/api-kit/core';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';

import type { Env } from '../../config/env';
import { QUEUE } from '../../queues';
import { DeviceAudit } from './device-audit';
import { DevicesPullQueue } from './devices-jobs';
import type { DeviceConnectionDoc } from './devices.collection';
import { DEVICES_POLICY } from './devices.policy';
import { DevicesRepository } from './devices.repository';
import {
  AggregatorError,
  WEARABLES_AGGREGATOR,
  type WearablesAggregator,
} from './wearables-aggregator';

export const SCHEDULE_PULL_JOB = 'schedule-pull';
export const CLEANUP_PENDING_JOB = 'cleanup-pending';
export const RECONCILE_JOB = 'reconcile';

/**
 * Регламент устройств (`devices-maintenance`): расписание pull активных подключений, уборка неподтверждённых за TTL
 * тикета (отзыв в агрегаторе, если он показывает подключение) и ежедневная сверка `active` ↔ агрегатор (нет или
 * истекло — `issue: 'reauthorize'`). Ошибка агрегатора по одному подключению не валит пачку — оно разберётся в
 * следующий запуск. Логи — счётчики.
 */
@Processor(QUEUE.devicesMaintenance)
export class DevicesMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(DevicesMaintenanceProcessor.name);

  constructor(
    private readonly repository: DevicesRepository,
    private readonly audit: DeviceAudit,
    private readonly transactions: MongoTransactions,
    private readonly pulls: DevicesPullQueue,
    @Inject(WEARABLES_AGGREGATOR) private readonly aggregator: WearablesAggregator,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job): Promise<number> {
    if (!this.env.DEVICES_ENABLED) return 0;
    switch (job.name) {
      case SCHEDULE_PULL_JOB:
        return this.schedulePull();
      case CLEANUP_PENDING_JOB:
        return this.cleanupPending();
      case RECONCILE_JOB:
        return this.reconcile();
      default:
        throw new Error(`unknown job ${job.name} in queue ${QUEUE.devicesMaintenance}`);
    }
  }

  /** Pull каждому активному подключению (дедупликация — в `DevicesPullQueue`). */
  async schedulePull(): Promise<number> {
    let scheduled = 0;
    for await (const connection of this.active()) {
      await this.pulls.schedule(connection._id, 'schedule');
      scheduled += 1;
    }
    this.logger.log(`devices.schedule_pull scheduled=${scheduled}`);
    return scheduled;
  }

  /** `pending` с истёкшим тикетом → отзыв в агрегаторе (если подключение там есть) → `revoked: unconfirmed`. */
  async cleanupPending(): Promise<number> {
    const now = this.clock.now();
    let revoked = 0;
    let deferred = 0;
    for (const connection of await this.repository.listExpiredPending(
      now,
      DEVICES_POLICY.batchSize,
    )) {
      try {
        const remote = await this.aggregator.listConnections(connection.aggUserId);
        const linked = remote.some(
          (item) => item.provider === connection.provider && item.status !== 'revoked',
        );
        if (linked)
          await this.aggregator.revokeConnection(connection.aggUserId, connection.provider);
      } catch (error) {
        if (!(error instanceof AggregatorError)) throw error;
        deferred += 1;
        continue;
      }
      const changed = await this.transactions.run(async (session) => {
        const updated = await this.repository.markRevoked(session, connection._id, 'pending', {
          reason: 'unconfirmed',
          revokeFailed: false,
          now: this.clock.now(),
        });
        if (updated) await this.disconnectedAudit(session, connection, 'unconfirmed');
        return updated;
      });
      if (changed) revoked += 1;
    }
    this.logger.log(`devices.cleanup_pending revoked=${revoked} deferred=${deferred}`);
    return revoked;
  }

  /** Активные подключения, которых в агрегаторе нет или они не `active`, — `issue: 'reauthorize'` + журнал. */
  async reconcile(): Promise<number> {
    let flagged = 0;
    const remoteByUser = new Map<string, Map<string, string> | null>();
    for await (const connection of this.active()) {
      let remote = remoteByUser.get(connection.aggUserId);
      if (remote === undefined) {
        try {
          const list = await this.aggregator.listConnections(connection.aggUserId);
          remote = new Map(list.map((item) => [item.provider, item.status]));
        } catch (error) {
          if (!(error instanceof AggregatorError)) throw error;
          remote = null;
        }
        remoteByUser.set(connection.aggUserId, remote);
      }
      if (remote === null || remote.get(connection.provider) === 'active') continue;
      const changed = await this.transactions.run(async (session) => {
        const updated = await this.repository.setIssue(session, connection._id, 'reauthorize');
        if (updated) {
          await this.audit.append(session, {
            userId: connection.userId,
            provider: connection.provider,
            connectionId: connection._id,
            action: 'reauthorize_required',
            reason: 'aggregator',
          });
        }
        return updated;
      });
      if (changed) flagged += 1;
    }
    this.logger.log(`devices.reconcile flagged=${flagged}`);
    return flagged;
  }

  private async disconnectedAudit(
    session: Parameters<DeviceAudit['append']>[0],
    connection: DeviceConnectionDoc,
    reason: string,
  ): Promise<void> {
    await this.audit.append(session, {
      userId: connection.userId,
      provider: connection.provider,
      connectionId: connection._id,
      action: 'disconnected',
      reason,
    });
  }

  private async *active(): AsyncGenerator<DeviceConnectionDoc> {
    let after: string | null = null;
    for (;;) {
      const batch = await this.repository.listActive(after, DEVICES_POLICY.batchSize);
      yield* batch;
      if (batch.length < DEVICES_POLICY.batchSize) return;
      after = batch.at(-1)?._id ?? null;
    }
  }
}

/**
 * Расписания регламента устройств; upsert идемпотентен — несколько worker не плодят дубли. Устройства выключены —
 * расписания снимаются.
 */
export function devicesSchedules(env: Pick<Env, 'DEVICES_SYNC_INTERVAL_MIN'>) {
  return [
    {
      id: 'devices.schedule-pull',
      repeat: { every: env.DEVICES_SYNC_INTERVAL_MIN * 60_000 },
      job: { name: SCHEDULE_PULL_JOB },
    },
    {
      id: 'devices.cleanup-pending',
      repeat: { every: DEVICES_POLICY.cleanupEveryMs },
      job: { name: CLEANUP_PENDING_JOB },
    },
    {
      id: 'devices.reconcile.daily',
      repeat: { pattern: '30 4 * * *', tz: 'Europe/Minsk' },
      job: { name: RECONCILE_JOB },
    },
  ];
}

@Injectable()
export class DevicesSchedules implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUE.devicesMaintenance) private readonly queue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const schedule of devicesSchedules(this.env)) {
      if (this.env.DEVICES_ENABLED) {
        await this.queue.upsertJobScheduler(schedule.id, schedule.repeat, schedule.job);
      } else {
        await this.queue.removeJobScheduler(schedule.id);
      }
    }
  }
}
