import { randomUUID } from 'node:crypto';

import { type AuditAction, FailedJobsView } from '@pokatim/contracts';
import { type MongoOutboxDoc, OUTBOX_COLLECTION } from '@rkarakulov/api-kit/mongo';
import { Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import { panel, panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import { REDIS_URL_TEST } from '../../../test/test-urls';
import { QUEUE } from '../../queues';
import { PanelAudit } from '../panel';
import { FailedJobQueues } from './failed-job-queues';

/**
 * «Упавшие задачи» панели (admin-failed-jobs): права, список по всем очередям без `data` и e-mail, повтор и удаление с
 * журналом, 404/409, откат журнала при сбое операции, застрявший outbox. Задачи падают по-настоящему: worker стенда
 * не запущен, задачу берёт ручной `Worker.getNextJob` и переводит в failed.
 */
const FAILED_JOBS = '/v1/admin/failed-jobs';
const QUEUE_NAME: string = QUEUE.panelEmail;
const REASON = { reason: 'Починили SMTP' };

let h: Harness;
let redis: Redis;
let admin: { userId: string; token: string };
beforeAll(async () => {
  h = await createHarness();
  redis = new Redis(REDIS_URL_TEST, { maxRetriesPerRequest: null });
});
beforeEach(async () => {
  await h.reset();
  admin = await staff(h, 'admin@example.by', 'admin');
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await redis.quit();
  await h.close();
});

const queue = (name: string = QUEUE_NAME): Queue => {
  const found = h.app.get(FailedJobQueues).get(name);
  if (!found) throw new Error(name);
  return found;
};

/** Задача, финально упавшая с `error` (одна попытка): ручная обработка без процессора. */
async function failedJob(
  error: string,
  data: Record<string, unknown> = { outboxEventId: randomUUID() },
  name = 'panel.invitation-email-requested',
): Promise<Job> {
  const added = await queue().add(name, data, { attempts: 1 });
  const worker = new Worker(QUEUE_NAME, null, {
    connection: redis.duplicate(),
    autorun: false,
    drainDelay: 1,
  });
  try {
    const token = randomUUID();
    // без блокировки BullMQ может вернуть пусто, пока не снят маркер очереди: короткая блокировка, до трёх раз
    let job: Job | undefined;
    for (let attempt = 0; attempt < 3 && !job; attempt += 1) {
      job = await worker.getNextJob(token, { block: true });
    }
    if (!job || job.id !== added.id) {
      const counts = await queue().getJobCounts();
      throw new Error(`job not taken: ${job?.id} vs ${added.id} ${JSON.stringify(counts)}`);
    }
    await job.moveToFailed(new Error(error), token, false);
    return job;
  } finally {
    await worker.close();
  }
}

const auditOf = (action: AuditAction) => panel(h).audit.find({ action }).toArray();
const view = async () => {
  const res = await panelCall(h, admin.token, 'GET', FAILED_JOBS);
  expect(res.status).toBe(200);
  return FailedJobsView.parse(res.body);
};

describe('права и список', () => {
  it('организатор и модератор — 403; без сессии — 401', async () => {
    for (const role of ['organizer', 'moderator'] as const) {
      const member = await staff(h, `${role}@example.by`, role);
      expect((await panelCall(h, member.token, 'GET', FAILED_JOBS)).status).toBe(403);
    }
    expect((await panelCall(h, undefined, 'GET', FAILED_JOBS)).status).toBe(401);
  });

  it('счётчики всех очередей; строка — явный список полей без data, ошибка — первая строка без e-mail', async () => {
    const event = randomUUID();
    const job = await failedJob('550 olga@example.by rejected\n    at smtp (x.js:1:1)', {
      outboxEventId: event,
      email: 'olga@example.by',
    });
    const body = await view();
    expect(body.queues.map((row) => row.queue)).toEqual(Object.values(QUEUE));
    expect(body.queues.find((row) => row.queue === QUEUE_NAME)?.failed).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0] ?? {}).sort()).toEqual(
      [
        'attempts',
        'attemptsMade',
        'createdAt',
        'error',
        'failedAt',
        'jobId',
        'name',
        'outboxEventId',
        'queue',
      ].sort(),
    );
    expect(body.items[0]).toMatchObject({
      queue: QUEUE_NAME,
      jobId: job.id,
      name: 'panel.invitation-email-requested',
      attemptsMade: 1,
      attempts: 1,
      error: '550 [e-mail] rejected',
      outboxEventId: event,
    });
    expect(JSON.stringify(body)).not.toContain('olga@example.by');
    expect(body.outbox).toEqual({ stuck: 0, oldestAt: null, items: [] });
  });

  it('фильтр очереди: своя — строки, другая — пусто; незнакомая — 404, кривая — 400', async () => {
    await failedJob('boom');
    const own = await panelCall(h, admin.token, 'GET', `${FAILED_JOBS}?queue=${QUEUE_NAME}`);
    expect(FailedJobsView.parse(own.body).items).toHaveLength(1);
    const other = await panelCall(
      h,
      admin.token,
      'GET',
      `${FAILED_JOBS}?queue=${QUEUE.ticketsEmail}`,
    );
    expect(FailedJobsView.parse(other.body).items).toEqual([]);
    expect((await panelCall(h, admin.token, 'GET', `${FAILED_JOBS}?queue=no-such`)).status).toBe(
      404,
    );
    expect((await panelCall(h, admin.token, 'GET', `${FAILED_JOBS}?queue=A_B`)).status).toBe(400);
  });

  it('outbox: не опубликованные старше 10 мин — застряли; свежие и опубликованные — нет', async () => {
    const now = h.clock.now().getTime();
    const doc = (minutesAgo: number, published: boolean): MongoOutboxDoc => ({
      _id: randomUUID(),
      type: 'tickets.issued',
      payload: {},
      createdAt: new Date(now - minutesAgo * MINUTE),
      publishedAt: published ? new Date(now) : null,
    });
    const old = doc(30, false);
    await h.db
      .collection<MongoOutboxDoc>(OUTBOX_COLLECTION)
      .insertMany([old, doc(5, false), doc(60, true), doc(11, false)]);
    const { outbox } = await view();
    expect(outbox.stuck).toBe(2);
    expect(outbox.oldestAt).toBe(old.createdAt.toISOString());
    expect(outbox.items.map((item) => item.id)[0]).toBe(old._id);
    expect(Object.keys(outbox.items[0] ?? {}).sort()).toEqual(['createdAt', 'id', 'type']);
  });
});

describe('повтор и удаление', () => {
  const action = (
    jobId: string,
    verb: 'retry' | 'delete',
    body: object = REASON,
    name = QUEUE_NAME,
  ) =>
    panelCall(
      h,
      admin.token,
      'POST',
      `${FAILED_JOBS}/${name}/${encodeURIComponent(jobId)}/${verb}`,
      body,
    );

  it('повтор — 204, задача ждёт с полными попытками; журнал с причиной; второй повтор — 409 без записи', async () => {
    const job = await failedJob('boom');
    const jobId = String(job.id);
    expect((await action(jobId, 'retry')).status).toBe(204);
    const retried = await queue().getJob(jobId);
    expect(await retried?.getState()).toBe('waiting');
    expect(retried?.attemptsMade).toBe(0);
    const audit = await auditOf('jobs.failed_retried');
    expect(audit.map((entry) => [entry.actor, entry.reason, entry.subject, entry.details])).toEqual(
      [
        [
          { kind: 'user', userId: admin.userId },
          REASON.reason,
          {
            kind: 'platform',
            id: '00000000-0000-0000-0000-000000000000',
            label: `${QUEUE_NAME} · ${jobId}`,
          },
          { queue: QUEUE_NAME, jobName: 'panel.invitation-email-requested' },
        ],
      ],
    );
    const again = await action(jobId, 'retry');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'CONFLICT' });
    expect(await auditOf('jobs.failed_retried')).toHaveLength(1);
  });

  it('удаление — 204, задачи нет; журнал; повтор по удалённой — 404', async () => {
    const jobId = String((await failedJob('boom')).id);
    expect((await action(jobId, 'delete')).status).toBe(204);
    expect(await queue().getJob(jobId)).toBeUndefined();
    expect(await auditOf('jobs.failed_removed')).toHaveLength(1);
    expect((await action(jobId, 'retry')).status).toBe(404);
    expect((await view()).items).toEqual([]);
  });

  it('незнакомая очередь и задача — 404; кривой id и тело без причины — 400; журнала нет', async () => {
    const jobId = String((await failedJob('boom')).id);
    expect((await action(jobId, 'retry', REASON, 'no-such')).status).toBe(404);
    expect((await action('missing-job', 'delete')).status).toBe(404);
    expect((await action('a b', 'retry')).status).toBe(400);
    expect((await action(jobId, 'retry', {})).status).toBe(400);
    expect(await panel(h).audit.countDocuments({ action: /^jobs\./ })).toBe(0);
  });

  it('ворота: задачу повторили между проверкой и удалением — 409, журнал откатился, задача жива', async () => {
    const jobId = String((await failedJob('boom')).id);
    const audit = h.app.get(PanelAudit);
    const original = audit.append.bind(audit);
    vi.spyOn(audit, 'append').mockImplementationOnce(async (...args) => {
      // другая вкладка успела «Повторить»: задача ушла в waiting
      await (await queue().getJob(jobId))?.retry('failed');
      return original(...args);
    });
    const res = await action(jobId, 'delete');
    expect(res.status).toBe(409);
    expect(await auditOf('jobs.failed_removed')).toHaveLength(0);
    expect(await (await queue().getJob(jobId))?.getState()).toBe('waiting');
  });

  it('операция BullMQ упала, задача всё ещё failed — ошибка, запись журнала откатилась', async () => {
    const jobId = String((await failedJob('boom')).id);
    vi.spyOn(Job.prototype, 'retry').mockRejectedValueOnce(new Error('redis down'));
    expect((await action(jobId, 'retry')).status).toBe(500);
    expect(await auditOf('jobs.failed_retried')).toHaveLength(0);
    expect(await (await queue().getJob(jobId))?.getState()).toBe('failed');
  });
});
