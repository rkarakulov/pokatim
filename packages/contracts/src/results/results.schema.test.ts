import { describe, expect, it } from 'vitest';

import { ErrorCode, FieldErrorCode } from '../common.ts';
import { RaceEditBlockReason } from '../races/race.schema.ts';
import {
  PanelRaceAttempt,
  PanelRaceAttemptQuery,
  PanelRaceResults,
} from './results-admin.schema.ts';
import {
  ATTEMPT_REJECTIONS,
  AttemptRequest,
  MyRaceEntry,
  RaceResultsPage,
  RaceResultsQuery,
} from './results.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-27T10:00:00.000Z';

const segment = {
  startedAt: AT,
  finishedAt: AT,
  elapsedSec: 3600,
  distanceM: 30_000,
  offCorridorM: 0,
  offCorridorShare: 0,
  maxExcursionM: 0,
  coverage: 1,
};

const myEntry = {
  raceId: ID,
  entry: { id: ID, status: 'active', createdAt: AT, withdrawnAt: null },
  result: {
    status: 'provisional',
    elapsedSec: 3600,
    place: 1,
    tied: false,
    ranked: 3,
    group: 'overall',
  },
  attempts: [
    {
      id: ID,
      origin: 'auto',
      status: 'counted',
      reasons: [],
      segment,
      isBest: true,
      activity: { id: ID, startedAt: AT, source: 'garmin', elapsedSec: 3700, distanceM: 31_000 },
      createdAt: AT,
      checkedAt: AT,
    },
  ],
  pendingUploads: [{ uploadId: ID, status: 'processing', failure: null }],
  uploadClosesAt: AT,
  actions: { canEnter: false, canWithdraw: true, canAddAttempt: true, reasons: [] },
};

describe('участие и результаты: приложение', () => {
  it('AttemptRequest — ровно одно поле, лишние ключи — ошибка', () => {
    expect(AttemptRequest.parse({ activityId: ID })).toEqual({ activityId: ID });
    expect(AttemptRequest.parse({ uploadId: ID })).toEqual({ uploadId: ID });
    expect(AttemptRequest.safeParse({ activityId: ID, uploadId: ID }).success).toBe(false);
    expect(AttemptRequest.safeParse({}).success).toBe(false);
    expect(AttemptRequest.safeParse({ activityId: ID, elapsedSec: 1 }).success).toBe(false);
    expect(AttemptRequest.safeParse({ activityId: 'x' }).success).toBe(false);
  });

  it('MyRaceEntry: незнакомые значения справочников — unknown', () => {
    expect(MyRaceEntry.parse(myEntry).result.status).toBe('provisional');
    const future = MyRaceEntry.parse({
      ...myEntry,
      entry: { ...myEntry.entry, status: 'suspended' },
      result: { ...myEntry.result, status: 'final', group: 'cluster_a' },
      attempts: [
        { ...myEntry.attempts[0], origin: 'judge', status: 'excluded', reasons: ['too_fast'] },
      ],
      pendingUploads: [{ uploadId: ID, status: 'paused', failure: 'virus' }],
      actions: { ...myEntry.actions, reasons: ['dispute_open'] },
    });
    expect(future.entry?.status).toBe('unknown');
    expect(future.result.status).toBe('unknown');
    expect(future.result.group).toBe('unknown');
    expect(future.attempts[0]?.origin).toBe('unknown');
    expect(future.attempts[0]?.status).toBe('unknown');
    expect(future.attempts[0]?.reasons).toEqual(['unknown']);
    expect(future.pendingUploads[0]).toEqual({
      uploadId: ID,
      status: 'unknown',
      failure: 'unknown',
    });
    expect(future.actions.reasons).toEqual(['unknown']);
    expect(MyRaceEntry.parse({ ...myEntry, entry: null }).entry).toBeNull();
  });

  it('таблица: запрос строгий, ответ терпит незнакомый статус', () => {
    expect(RaceResultsQuery.parse({})).toEqual({ limit: 50 });
    expect(RaceResultsQuery.parse({ limit: '100' }).limit).toBe(100);
    expect(RaceResultsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(RaceResultsQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(RaceResultsQuery.safeParse({ userId: ID }).success).toBe(false);
    const page = RaceResultsPage.parse({
      group: 'overall',
      status: 'final',
      ranked: 1,
      entries: 2,
      items: [{ entryId: ID, place: 1, tied: false, elapsedSec: 3600 }],
      nextCursor: null,
    });
    expect(page.status).toBe('unknown');
  });

  it('причины отказа — коды движка + implausible в конце', () => {
    expect(ATTEMPT_REJECTIONS.at(-1)).toBe('implausible');
    expect(ATTEMPT_REJECTIONS).toHaveLength(9);
  });

  it('коды ошибок и причины правки — в конце справочников', () => {
    for (const code of [
      'RACE_ENTRY_CLOSED',
      'RACE_ENTRY_WITHDRAWN',
      'RACE_ENTRY_REQUIRED',
      'RACE_WITHDRAW_CLOSED',
      'ATTEMPT_UPLOAD_CLOSED',
      'ATTEMPT_LIMIT',
      'ATTEMPT_SOURCE_INVALID',
    ]) {
      expect(ErrorCode.options).toContain(code);
    }
    expect(ErrorCode.options.at(-1)).toBe('ATTEMPT_SOURCE_INVALID');
    expect(FieldErrorCode.options.at(-1)).toBe('CORRIDOR_GATES_OVERLAP');
    expect(RaceEditBlockReason.options.at(-1)).toBe('entries_locked');
  });
});

describe('участие и результаты: панель', () => {
  const attempt = {
    id: ID,
    entryId: ID,
    userId: ID,
    activityId: ID,
    origin: 'auto',
    status: 'failed',
    hidden: false,
    reasons: [],
    failure: 'timeout',
    withdrawReason: null,
    segment: null,
    engineVersion: 1,
    checkRevision: 2,
    checkAttempts: 1,
    diagnostics: null,
    createdAt: AT,
    checkedAt: AT,
  };

  it('строгие enum: незнакомое значение — ошибка', () => {
    expect(PanelRaceAttempt.parse(attempt).failure).toBe('timeout');
    expect(PanelRaceAttempt.safeParse({ ...attempt, status: 'excluded' }).success).toBe(false);
    expect(PanelRaceAttempt.safeParse({ ...attempt, failure: 'virus' }).success).toBe(false);
    expect(PanelRaceAttemptQuery.parse({ status: 'failed' })).toEqual({
      status: 'failed',
      limit: 50,
    });
    expect(PanelRaceAttemptQuery.safeParse({ status: 'nope' }).success).toBe(false);
    expect(PanelRaceAttemptQuery.safeParse({ userId: ID }).success).toBe(false);
  });

  it('сводка: счётчики по всем статусам, незнакомый — ошибка', () => {
    const summary = {
      raceId: ID,
      lockedAt: null,
      engineVersion: 1,
      counts: {
        entries: 2,
        active: 1,
        withdrawn: 1,
        ranked: 1,
        attempts: { queued: 0, checking: 0, counted: 1, rejected: 0, failed: 1, withdrawn: 0 },
        hidden: 0,
        failed: 1,
        staleEngine: 0,
      },
    };
    expect(PanelRaceResults.parse(summary).counts.failed).toBe(1);
    expect(
      PanelRaceResults.safeParse({
        ...summary,
        counts: { ...summary.counts, attempts: { ...summary.counts.attempts, excluded: 1 } },
      }).success,
    ).toBe(false);
  });
});
