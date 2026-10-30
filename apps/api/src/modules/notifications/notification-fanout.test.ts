import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { describe, expect, it } from 'vitest';

import { planFanout } from './notification-fanout';
import type { NoticeDraft } from './notification-intake';
import {
  FanoutJobData,
  fanoutJobId,
  NOTIFICATIONS_FANOUT_JOB,
  notificationsOutboxRoutes,
} from './notifications.events';
import { NOTIFICATIONS_POLICY } from './notifications.policy';

const EVENT = uuidv7();
const TYPE = 'results.protocol-published';
const users = (n: number) => Array.from({ length: n }, () => uuidv7());
const draft = (recipients: string[], overrides: Partial<NoticeDraft> = {}): NoticeDraft => ({
  text: { kind: 'protocol_published', race: 'Минское кольцо' },
  target: { type: 'race', raceId: EVENT },
  recipients,
  ...overrides,
});
const plan = (drafts: NoticeDraft[]) => planFanout(EVENT, TYPE, drafts, 200);

describe('planFanout: пачки получателей', () => {
  it('порог — fanoutChunk = 200: аудитория ≤ порога — null (одна задача intake)', () => {
    expect(NOTIFICATIONS_POLICY.fanoutChunk).toBe(200);
    expect(plan([])).toBeNull();
    expect(plan([draft(users(10))])).toBeNull();
    expect(plan([draft(users(200))])).toBeNull();
    expect(plan([draft(users(120)), draft(users(80))])).toBeNull();
  });

  it('201 — две пачки (200 + 1), снимок текста, цель и тип; данные проходят FanoutJobData', () => {
    const recipients = users(201);
    const chunks = plan([draft(recipients)]);
    expect(chunks?.map((chunk) => [chunk.jobId, chunk.data.userIds.length])).toEqual([
      [fanoutJobId(EVENT, 0, 0), 200],
      [fanoutJobId(EVENT, 0, 1), 1],
    ]);
    expect(chunks?.flatMap((chunk) => chunk.data.userIds)).toEqual(recipients);
    expect(chunks?.[0]?.data).toMatchObject({
      eventId: EVENT,
      type: TYPE,
      kind: 'protocol_published',
      title: 'Протокол опубликован',
      body: '«Минское кольцо»: итоговый протокол готов.',
      target: { type: 'race', raceId: EVENT },
    });
    for (const chunk of chunks ?? []) {
      expect(FanoutJobData.parse(chunk.data)).toEqual(chunk.data);
      expect(chunk.jobId).not.toContain(':');
    }
  });

  it('450 в одном черновике — 3 пачки -0-0, -0-1, -0-2; повторы получателя не считаются', () => {
    const recipients = users(450);
    const chunks = plan([draft([...recipients, ...recipients.slice(0, 50)])]);
    expect(chunks?.map((chunk) => chunk.jobId)).toEqual([
      `fanout-${EVENT}-0-0`,
      `fanout-${EVENT}-0-1`,
      `fanout-${EVENT}-0-2`,
    ]);
    expect(chunks?.map((chunk) => chunk.data.userIds.length)).toEqual([200, 200, 50]);
    // 200 уникальных с повторами — не больше порога
    const few = users(150);
    expect(plan([draft([...few, ...few, ...users(50)])])).toBeNull();
  });

  it('пустой черновик не получает номер: сторож -0-0 есть при пустом первом', () => {
    const chunks = plan([draft([]), draft(users(201))]);
    expect(chunks?.map((chunk) => chunk.jobId)).toEqual([
      fanoutJobId(EVENT, 0, 0),
      fanoutJobId(EVENT, 0, 1),
    ]);
  });

  it('сумма двух черновиков больше порога — пачки обоих со своим текстом и схлопыванием', () => {
    const chunks = plan([
      draft(users(150)),
      draft(users(100), {
        text: { kind: 'protocol_rechecked', race: 'Минское кольцо' },
        collapse: { key: 'race:x', seq: 3 },
      }),
    ]);
    expect(chunks?.map((chunk) => [chunk.jobId, chunk.data.kind, chunk.data.collapse])).toEqual([
      [fanoutJobId(EVENT, 0, 0), 'protocol_published', undefined],
      [fanoutJobId(EVENT, 1, 0), 'protocol_rechecked', { key: 'race:x', seq: 3 }],
    ]);
  });

  it('targets пачки — только её получатели', () => {
    const recipients = users(201);
    const targets = new Map(
      recipients.map((userId, i) => [
        userId,
        { type: 'ticket' as const, code: `ABCDEFG${String(i).padStart(3, '0')}`.slice(0, 10) },
      ]),
    );
    const chunks = plan([draft(recipients, { target: null, targets })]);
    expect(Object.keys(chunks?.[0]?.data.targets ?? {})).toEqual(recipients.slice(0, 200));
    expect(chunks?.[1]?.data.targets).toEqual({
      [recipients[200]!]: targets.get(recipients[200]!),
    });
    expect(chunks?.[1]?.data.target).toBeNull();
  });

  it('имя задачи пачки не совпадает ни с одним типом событий outbox', () => {
    expect(NOTIFICATIONS_FANOUT_JOB).toBe('notifications.fanout');
    expect(Object.keys(notificationsOutboxRoutes)).not.toContain(NOTIFICATIONS_FANOUT_JOB);
  });
});
