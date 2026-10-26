import { describe, expect, it } from 'vitest';

import { ErrorCode, FieldErrorCode } from '../common.ts';
import { RaceEditBlockReason } from '../races/race.schema.ts';
import {
  ATTEMPT_REVIEW_KINDS,
  PanelProtocolRecalculations,
  PanelRaceAttempt,
  PanelRaceAttemptQuery,
  PanelRaceResults,
  PanelRaceStandings,
  PROTOCOL_ROW_STATUSES,
  ProtocolEntryActionRequest,
  PUBLISH_CHECKS,
  PUBLISH_STATE_BLOCKS,
  RECALCULATION_KINDS,
  RESULTS_ACTION_BLOCKS,
  ResultsActionBlockedDetails,
  ResultsActionRequest,
  ResultsPublishBlockedDetails,
} from './results-admin.schema.ts';
import {
  ATTEMPT_REJECTIONS,
  ATTEMPT_STATUSES,
  RACE_RESULT_STATUSES,
  RACE_RESULTS_STATUSES,
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
      result: { ...myEntry.result, status: 'appealed', group: 'cluster_a' },
      attempts: [
        { ...myEntry.attempts[0], origin: 'judge', status: 'judged', reasons: ['too_fast'] },
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
      status: 'archived',
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
    expect(ErrorCode.options.slice(-2)).toEqual([
      'RESULTS_ACTION_BLOCKED',
      'RESULTS_PUBLISH_BLOCKED',
    ]);
    expect(FieldErrorCode.options.at(-1)).toBe('CORRIDOR_GATES_OVERLAP');
    expect(RaceEditBlockReason.options.slice(-2)).toEqual(['entries_locked', 'results_final']);
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
    review: null,
  };

  it('строгие enum: незнакомое значение — ошибка; excluded — статус попытки и фильтра', () => {
    expect(PanelRaceAttempt.parse(attempt).failure).toBe('timeout');
    expect(PanelRaceAttempt.parse({ ...attempt, status: 'excluded' }).status).toBe('excluded');
    expect(PanelRaceAttempt.safeParse({ ...attempt, status: 'judged' }).success).toBe(false);
    expect(PanelRaceAttempt.safeParse({ ...attempt, failure: 'virus' }).success).toBe(false);
    expect(PanelRaceAttemptQuery.parse({ status: 'excluded' })).toEqual({
      status: 'excluded',
      limit: 50,
    });
    expect(PanelRaceAttemptQuery.safeParse({ status: 'nope' }).success).toBe(false);
    expect(PanelRaceAttemptQuery.safeParse({ userId: ID }).success).toBe(false);
  });

  it('причина исключения попытки (RC-10): вид из справочника', () => {
    const review = { kind: 'excluded', reason: 'Чужой трек', at: AT };
    expect(PanelRaceAttempt.parse({ ...attempt, review }).review).toEqual(review);
    expect(
      PanelRaceAttempt.safeParse({ ...attempt, review: { ...review, kind: 'deleted' } }).success,
    ).toBe(false);
    expect(ATTEMPT_REVIEW_KINDS).toEqual(['excluded', 'restored']);
  });

  const checklist = PUBLISH_CHECKS.map((code) => ({ code, count: 0 }));
  const summary = {
    raceId: ID,
    lockedAt: null,
    engineVersion: 1,
    counts: {
      entries: 2,
      active: 1,
      withdrawn: 1,
      ranked: 1,
      attempts: {
        queued: 0,
        checking: 0,
        counted: 1,
        rejected: 0,
        failed: 1,
        withdrawn: 0,
        excluded: 0,
      },
      hidden: 0,
      failed: 1,
      staleEngine: 0,
    },
    phase: 'closed',
    uploadClosesAt: AT,
    protocol: null,
    recheck: null,
    publish: { canPublish: true, blockedBy: null, checklist },
  };

  it('сводка: счётчики по всем статусам (с excluded), фаза, протокол и чек-лист', () => {
    expect(PanelRaceResults.parse(summary).counts.attempts.excluded).toBe(0);
    const { excluded: _excluded, ...withoutExcluded } = summary.counts.attempts;
    expect(
      PanelRaceResults.safeParse({
        ...summary,
        counts: { ...summary.counts, attempts: withoutExcluded },
      }).success,
    ).toBe(false);
    const published = PanelRaceResults.parse({
      ...summary,
      phase: 'final',
      protocol: {
        publishedAt: AT,
        revision: 2,
        ranked: 3,
        disqualified: 1,
        recheckPending: false,
      },
      recheck: { startedAt: AT, pending: 4 },
      publish: { canPublish: false, blockedBy: 'published', checklist },
    });
    expect(published.protocol?.revision).toBe(2);
    expect(PanelRaceResults.safeParse({ ...summary, phase: 'archived' }).success).toBe(false);
    expect(
      PanelRaceResults.safeParse({
        ...summary,
        publish: { canPublish: false, blockedBy: 'frozen', checklist },
      }).success,
    ).toBe(false);
    expect(
      PanelRaceResults.safeParse({
        ...summary,
        publish: { ...summary.publish, checklist: [{ code: 'flags', count: 1 }] },
      }).success,
    ).toBe(false);
  });

  it('справочники протокола — в установленном порядке', () => {
    expect(PUBLISH_CHECKS).toEqual([
      'open_disputes',
      'unprocessed_tracks',
      'checks_queued',
      'checks_failed',
      'window_open',
    ]);
    expect(PUBLISH_STATE_BLOCKS).toEqual(['draft', 'cancelled', 'no_corridor', 'published']);
    expect(RESULTS_ACTION_BLOCKS).toEqual([
      'protocol_published',
      'protocol_not_published',
      'race_cancelled',
      'attempt_state',
      'row_state',
      'checks_pending',
      'recheck_not_started',
    ]);
    expect(RECALCULATION_KINDS).toEqual([
      'published',
      'disqualified',
      'disqualification_revoked',
      'recheck_started',
      'recheck_applied',
    ]);
    expect(PROTOCOL_ROW_STATUSES).toEqual(['final', 'revised', 'dq']);
    expect(RACE_RESULT_STATUSES.slice(-3)).toEqual(['final', 'dq', 'revised']);
    expect(ATTEMPT_STATUSES.at(-1)).toBe('excluded');
    expect(RACE_RESULTS_STATUSES).toEqual(['provisional', 'final']);
  });

  it('запросы действий: только причина (3–500) и id участника; лишние ключи — ошибка', () => {
    expect(ResultsActionRequest.parse({ reason: '  Чужой трек  ' })).toEqual({
      reason: 'Чужой трек',
    });
    expect(ResultsActionRequest.safeParse({ reason: 'ab' }).success).toBe(false);
    expect(ResultsActionRequest.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(ResultsActionRequest.safeParse({ reason: 'Причина', place: 1 }).success).toBe(false);
    expect(ResultsActionRequest.safeParse({}).success).toBe(false);
    expect(ProtocolEntryActionRequest.parse({ entryId: ID, reason: 'Срезка' })).toEqual({
      entryId: ID,
      reason: 'Срезка',
    });
    expect(ProtocolEntryActionRequest.safeParse({ entryId: 'x', reason: 'Срезка' }).success).toBe(
      false,
    );
    expect(
      ProtocolEntryActionRequest.safeParse({ entryId: ID, reason: 'Срезка', elapsedSec: 1 })
        .success,
    ).toBe(false);
  });

  it('детали блокировок: причина из справочника, количество; чек-лист публикации', () => {
    expect(ResultsActionBlockedDetails.parse({ reason: 'checks_pending', count: 3 })).toEqual({
      reason: 'checks_pending',
      count: 3,
    });
    expect(ResultsActionBlockedDetails.safeParse({ reason: 'busy' }).success).toBe(false);
    expect(
      ResultsPublishBlockedDetails.parse({ blockedBy: null, checklist }).checklist,
    ).toHaveLength(5);
  });

  it('участники и история пересчётов', () => {
    const row = {
      entryId: ID,
      userId: ID,
      entryStatus: 'active',
      resultStatus: 'dq',
      place: null,
      tied: false,
      elapsedSec: 3600,
      bestAttemptId: ID,
      summary: { total: 1, pending: 0, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 },
    };
    expect(
      PanelRaceStandings.parse({ source: 'protocol', revision: 2, truncated: false, items: [row] })
        .items[0]?.resultStatus,
    ).toBe('dq');
    expect(
      PanelRaceStandings.safeParse({
        source: 'archive',
        revision: null,
        truncated: false,
        items: [],
      }).success,
    ).toBe(false);
    expect(
      PanelRaceStandings.safeParse({
        source: 'live',
        revision: null,
        truncated: false,
        items: [{ ...row, resultStatus: 'appealed' }],
      }).success,
    ).toBe(false);
    const recalculation = {
      id: ID,
      kind: 'disqualified',
      entryId: ID,
      revision: 2,
      reason: 'Срезка',
      actor: { userId: ID, displayName: 'Ольга' },
      at: AT,
    };
    expect(PanelProtocolRecalculations.parse({ items: [recalculation] }).items).toHaveLength(1);
    expect(
      PanelProtocolRecalculations.safeParse({ items: [{ ...recalculation, kind: 'rolled_back' }] })
        .success,
    ).toBe(false);
  });
});
