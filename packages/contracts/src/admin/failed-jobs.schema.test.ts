import { describe, expect, it } from 'vitest';

import {
  FailedJobActionRequest,
  FailedJobId,
  FailedJobRow,
  FailedJobsQuery,
  FailedJobsView,
  QueueName,
} from './failed-jobs.schema.ts';

const EVENT = '01890a5d-ac96-774b-bcce-b302099a8057';

const row = {
  queue: 'notifications-intake',
  jobId: EVENT,
  name: 'races.race-cancelled',
  attemptsMade: 5,
  attempts: 5,
  error: 'Connection refused',
  createdAt: '2026-11-01T10:00:00.000Z',
  failedAt: '2026-11-01T10:05:00.000Z',
  outboxEventId: EVENT,
};

describe('FailedJobsQuery', () => {
  it('limit по умолчанию 50, не больше 100; очередь — kebab-case; лишние параметры — ошибка', () => {
    expect(FailedJobsQuery.parse({})).toEqual({ limit: 50 });
    expect(FailedJobsQuery.parse({ queue: 'panel-email', limit: '10' })).toEqual({
      queue: 'panel-email',
      limit: 10,
    });
    expect(FailedJobsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(FailedJobsQuery.safeParse({ queue: 'Panel_Email' }).success).toBe(false);
    expect(FailedJobsQuery.safeParse({ 'queue[$ne]': 'x' }).success).toBe(false);
  });
});

describe('параметры пути', () => {
  it('QueueName и FailedJobId — без слэшей, пробелов и пустых', () => {
    expect(QueueName.safeParse('notifications-delivery').success).toBe(true);
    for (const bad of ['', 'a/b', 'a b', 'x'.repeat(65)]) {
      expect(QueueName.safeParse(bad).success, bad).toBe(false);
    }
    for (const ok of [EVENT, `push-${EVENT}-1730455200000`, 'story-card-AbC_9', 'repeat:abc:1']) {
      expect(FailedJobId.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['', '../x', 'a b', 'x'.repeat(201)]) {
      expect(FailedJobId.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('FailedJobsView', () => {
  it('строка без outbox и без ошибки разбирается; ошибка длиннее 300 — нет', () => {
    const plain = { ...row, error: null, failedAt: null, attempts: null, outboxEventId: null };
    expect(FailedJobRow.parse(plain)).toEqual(plain);
    expect(FailedJobRow.safeParse({ ...row, error: 'x'.repeat(301) }).success).toBe(false);
    const view = {
      queues: [{ queue: 'notifications-intake', failed: 1 }],
      items: [row],
      outbox: { stuck: 0, oldestAt: null, items: [] },
    };
    expect(FailedJobsView.parse(view)).toEqual(view);
  });
});

describe('FailedJobActionRequest', () => {
  it('причина обязательна; лишние ключи — ошибка', () => {
    expect(FailedJobActionRequest.safeParse({ reason: 'Починили SMTP' }).success).toBe(true);
    expect(FailedJobActionRequest.safeParse({}).success).toBe(false);
    expect(FailedJobActionRequest.safeParse({ reason: 'Починили SMTP', force: true }).success).toBe(
      false,
    );
  });
});
