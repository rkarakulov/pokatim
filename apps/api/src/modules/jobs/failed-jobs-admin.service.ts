import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  FailedJobActionRequest,
  FailedJobQueueCount,
  FailedJobRow,
  FailedJobsQuery,
  FailedJobsView,
} from '@pokatim/contracts';
import { OUTBOX_STUCK_ITEMS_MAX } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { MONGO_DB, OUTBOX_COLLECTION, type MongoOutboxDoc } from '@rkarakulov/api-kit/mongo';
import type { Job, Queue } from 'bullmq';
import type { Db } from 'mongodb';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { PanelAudit } from '../panel';
import { FailedJobQueues, QUEUE_NAMES } from './failed-job-queues';
import { FAILED_JOBS_POLICY, jobSubjectLabel, outboxEventIdOf, panelJobError } from './jobs.policy';

/** Объект журнала «платформа» (как оформление приложения): у задачи BullMQ нет UUID. */
const PLATFORM_SUBJECT_ID = '00000000-0000-0000-0000-000000000000';

type Action = 'retry' | 'delete';
const AUDIT_ACTION = { retry: 'jobs.failed_retried', delete: 'jobs.failed_removed' } as const;

const iso = (ms: number | undefined | null) =>
  typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null;

function toRow(queue: string, job: Job): FailedJobRow {
  return {
    queue,
    jobId: String(job.id),
    name: job.name,
    attemptsMade: job.attemptsMade,
    attempts:
      typeof job.opts.attempts === 'number' && job.opts.attempts > 0 ? job.opts.attempts : null,
    error: panelJobError(job.failedReason),
    createdAt: iso(job.timestamp) ?? new Date(0).toISOString(),
    failedAt: iso(job.finishedOn),
    outboxEventId: outboxEventIdOf(job.data),
  };
}

/**
 * «Упавшие задачи» панели (admin-failed-jobs, `platform.stats` — только admin): финальные провалы BullMQ по всем
 * очередям `QUEUE` и застрявшие события outbox (только чтение). «Повторить» и «Удалить» — над задачей в failed:
 * транзакция { журнал `jobs.failed_*` → операция BullMQ последней } — сбой операции откатывает запись журнала.
 * Наружу — явный список полей строки, без `data` задачи; текст ошибки — `panelJobError`.
 */
@Injectable()
export class FailedJobsAdminService {
  private readonly logger = new Logger(FailedJobsAdminService.name);

  constructor(
    private readonly queues: FailedJobQueues,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(MONGO_DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async view(query: FailedJobsQuery): Promise<FailedJobsView> {
    if (query.queue !== undefined && !this.queues.get(query.queue)) {
      throw domainError('NOT_FOUND', 404);
    }
    const counts = await Promise.all(
      QUEUE_NAMES.map(async (name): Promise<FailedJobQueueCount> => {
        const { failed = 0 } = await this.queue(name).getJobCounts('failed');
        return { queue: name, failed };
      }),
    );
    const names = counts
      .filter(
        (count) => count.failed > 0 && (query.queue === undefined || count.queue === query.queue),
      )
      .map((count) => count.queue);
    const rows = (
      await Promise.all(
        names.map(async (name) =>
          (await this.queue(name).getFailed(0, query.limit - 1))
            .filter((job): job is Job => Boolean(job))
            .map((job) => toRow(name, job)),
        ),
      )
    ).flat();
    rows.sort((a, b) => (b.failedAt ?? b.createdAt).localeCompare(a.failedAt ?? a.createdAt));
    return { queues: counts, items: rows.slice(0, query.limit), outbox: await this.stuckOutbox() };
  }

  retry(actorUserId: string, queue: string, jobId: string, body: FailedJobActionRequest) {
    return this.act('retry', actorUserId, queue, jobId, body);
  }

  remove(actorUserId: string, queue: string, jobId: string, body: FailedJobActionRequest) {
    return this.act('delete', actorUserId, queue, jobId, body);
  }

  /**
   * Лимит сотрудника → очередь и задача (нет — 404) → задача в failed (иначе 409) → транзакция { журнал → операция }.
   * Операция упала, а задача уже не в failed (повтор или удаление из другой вкладки, worker) — 409; иначе ошибка дальше.
   */
  private async act(
    action: Action,
    actorUserId: string,
    name: string,
    jobId: string,
    body: FailedJobActionRequest,
  ): Promise<void> {
    await consumeUserLimit(
      this.rateLimiter,
      `failed-jobs-panel:${actorUserId}`,
      FAILED_JOBS_POLICY.actionLimit,
      this.clock.now(),
    );
    const queue = this.queues.get(name);
    const job = queue && (await queue.getJob(jobId));
    if (!job) throw domainError('NOT_FOUND', 404);
    if (!(await job.isFailed())) throw domainError('CONFLICT', 409);
    await this.transactions.run(async (tx) => {
      await this.audit.append(tx, {
        action: AUDIT_ACTION[action],
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'platform', id: PLATFORM_SUBJECT_ID, label: jobSubjectLabel(name, jobId) },
        reason: body.reason,
        details: { queue: name, jobName: job.name },
      });
      try {
        if (action === 'retry') {
          await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
        } else {
          // `remove` состояние не проверяет (удалит и повторённую из другой вкладки — waiting): перепроверка сразу
          // перед ним сужает окно до одного обращения к Redis; `retry` проверяет состояние в своём скрипте
          if (!(await job.isFailed())) throw domainError('CONFLICT', 409);
          await job.remove();
        }
      } catch (error) {
        if (await job.isFailed()) throw error;
        throw domainError('CONFLICT', 409);
      }
    });
    this.logger.log(`${AUDIT_ACTION[action]} queue=${name} job=${jobId} by=${actorUserId}`);
  }

  private queue(name: string): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`unknown queue ${name}`);
    return queue;
  }

  /** События без публикации дольше `outboxStuckMs`: число (до предела), самое давнее и первые строки. */
  private async stuckOutbox(): Promise<FailedJobsView['outbox']> {
    const before = new Date(this.clock.now().getTime() - FAILED_JOBS_POLICY.outboxStuckMs);
    const outbox = this.db.collection<MongoOutboxDoc>(OUTBOX_COLLECTION);
    const filter = { publishedAt: null, createdAt: { $lt: before } };
    const [stuck, docs] = await Promise.all([
      outbox.countDocuments(filter, { limit: FAILED_JOBS_POLICY.outboxCountMax }),
      outbox
        .find(filter, { projection: { _id: 1, type: 1, createdAt: 1 } })
        .sort({ createdAt: 1 })
        .limit(OUTBOX_STUCK_ITEMS_MAX)
        .toArray(),
    ]);
    return {
      stuck,
      oldestAt: docs[0]?.createdAt.toISOString() ?? null,
      items: docs.map((doc) => ({
        id: doc._id,
        type: doc.type,
        createdAt: doc.createdAt.toISOString(),
      })),
    };
  }
}
