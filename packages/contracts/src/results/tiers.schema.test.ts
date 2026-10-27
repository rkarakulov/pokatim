import { describe, expect, it } from 'vitest';

import { DISPUTE_FILE_BLOCKS } from '../disputes/disputes.schema.ts';
import { ErrorCode } from '../common.ts';
import {
  ATTEMPT_SENSOR_SOURCES,
  AttemptSensors,
  PanelAttemptFlag,
  PanelRaceStandingsQuery,
} from './results-admin.schema.ts';
import {
  ATTEMPT_FLAG_CODES,
  ENTRY_TIERS,
  GROUP_SCHEMES,
  MyRaceEntry,
  RACE_RESULT_STATUSES,
  RaceEntryRequest,
  RaceFinishersPage,
  RaceFinishersQuery,
  RaceResultsPage,
  RaceResultsQuery,
  RESULT_GROUP_KEYS,
  RESULT_UNRANKED_REASONS,
  RIDER_GENDERS,
} from './results.schema.ts';

/*
 * race-results-07: уровни заявки, группы зачёта, финишёры, флаги. Порядок справочников — контракт (только в конец);
 * ответы приложения со старого сервера разбираются через `.default`.
 */

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-27T10:00:00.000Z';

const oldServerEntry = {
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
  attempts: [],
  pendingUploads: [],
  uploadClosesAt: AT,
  actions: { canEnter: false, canWithdraw: true, canAddAttempt: true, reasons: [] },
};

describe('race-results-07: справочники', () => {
  it('значения — в установленном порядке, новые только в конец', () => {
    expect(ENTRY_TIERS).toEqual(['verified', 'start']);
    expect(GROUP_SCHEMES).toEqual(['overall', 'gender_age']);
    expect(RIDER_GENDERS).toEqual(['m', 'w']);
    expect(RESULT_GROUP_KEYS).toEqual([
      'overall',
      'm_u40',
      'm_40_49',
      'm_50p',
      'w_u40',
      'w_40_49',
      'w_50p',
    ]);
    expect(ATTEMPT_FLAG_CODES).toEqual(['SPEED_CLUSTER_HIGH', 'HR_POWER_DECOUPLED', 'HR_GAPS']);
    expect(RESULT_UNRANKED_REASONS).toEqual(['start', 'no_heart_rate']);
    expect(RACE_RESULT_STATUSES.slice(-4)).toEqual(['final', 'dq', 'revised', 'finisher']);
    expect(DISPUTE_FILE_BLOCKS.at(-1)).toBe('not_ranked');
    // routes-06 добавил свой код после — проверяем блок 07 подряд, а не хвост списка
    const first = ErrorCode.options.indexOf('VERIFIED_PROFILE_REQUIRED');
    expect(ErrorCode.options.slice(first, first + 4)).toEqual([
      'VERIFIED_PROFILE_REQUIRED',
      'RACE_TIER_LOCKED',
      'RESULT_GROUP_NOT_ALLOWED',
      'VERIFIED_DEMOGRAPHICS_LOCKED',
    ]);
  });
});

describe('race-results-07: заявка', () => {
  it('RaceEntryRequest: пусто и undefined — допустимы; лишний ключ и чужое значение — ошибка', () => {
    expect(RaceEntryRequest.parse(undefined)).toBeUndefined();
    expect(RaceEntryRequest.parse({})).toEqual({});
    expect(RaceEntryRequest.parse({ tier: 'verified', groupKey: 'm_u40' })).toEqual({
      tier: 'verified',
      groupKey: 'm_u40',
    });
    expect(RaceEntryRequest.safeParse({ tier: 'pro' }).success).toBe(false);
    expect(RaceEntryRequest.safeParse({ groupKey: 'cluster_a' }).success).toBe(false);
    expect(RaceEntryRequest.safeParse({ tier: 'start', place: 1 }).success).toBe(false);
  });

  it('MyRaceEntry старого сервера — новые поля по умолчанию', () => {
    const parsed = MyRaceEntry.parse(oldServerEntry);
    expect(parsed.groupScheme).toBe('overall');
    expect(parsed.entry?.tier).toBeNull();
    expect(parsed.entry?.groupKey).toBeNull();
    expect(parsed.result.unranked).toBeNull();
    expect(parsed.verified).toBeNull();
    expect(parsed.actions.canUpgrade).toBe(false);
  });

  it('MyRaceEntry нового сервера: незнакомые значения — unknown', () => {
    const parsed = MyRaceEntry.parse({
      ...oldServerEntry,
      groupScheme: 'clusters',
      entry: { ...oldServerEntry.entry, tier: 'pro', groupKey: 'x_60p' },
      result: { ...oldServerEntry.result, status: 'finisher', unranked: 'later' },
      verified: { profileReady: true, ownGroup: 'm_50p', groupOptions: ['m_50p', 'x_60p'] },
      actions: { ...oldServerEntry.actions, canUpgrade: true },
    });
    expect(parsed.groupScheme).toBe('unknown');
    expect(parsed.entry?.tier).toBe('unknown');
    expect(parsed.entry?.groupKey).toBe('unknown');
    expect(parsed.result.status).toBe('finisher');
    expect(parsed.result.unranked).toBe('unknown');
    expect(parsed.verified).toEqual({
      profileReady: true,
      ownGroup: 'm_50p',
      groupOptions: ['m_50p', 'unknown'],
    });
    expect(parsed.actions.canUpgrade).toBe(true);
  });
});

describe('race-results-07: таблица и финишёры', () => {
  it('RaceResultsQuery: group — из справочника', () => {
    expect(RaceResultsQuery.parse({ group: 'w_40_49' })).toEqual({ limit: 50, group: 'w_40_49' });
    expect(RaceResultsQuery.safeParse({ group: 'cluster' }).success).toBe(false);
  });

  it('RaceResultsPage старого сервера — groups: [], finishers: 0', () => {
    const page = RaceResultsPage.parse({
      group: 'overall',
      status: 'provisional',
      ranked: 0,
      entries: 0,
      items: [],
      nextCursor: null,
    });
    expect(page.groups).toEqual([]);
    expect(page.finishers).toBe(0);
    const next = RaceResultsPage.parse({
      ...page,
      groups: [
        { key: 'm_u40', ranked: 2 },
        { key: 'x', ranked: 1 },
      ],
      finishers: 3,
    });
    expect(next.groups.map((g) => g.key)).toEqual(['m_u40', 'unknown']);
  });

  it('финишёры: запрос строгий, строка без места', () => {
    expect(RaceFinishersQuery.parse({})).toEqual({ limit: 50 });
    expect(RaceFinishersQuery.safeParse({ group: 'm_u40' }).success).toBe(false);
    const page = RaceFinishersPage.parse({
      total: 1,
      items: [{ entryId: ID, elapsedSec: 3600, unranked: 'start' }],
      nextCursor: null,
    });
    expect(page.items[0]).toEqual({
      entryId: ID,
      elapsedSec: 3600,
      riderName: null,
      unranked: 'start',
    });
    expect(
      RaceFinishersPage.parse({
        total: 1,
        items: [{ entryId: ID, elapsedSec: 1, riderName: 'А', unranked: 'later' }],
        nextCursor: null,
      }).items[0]?.unranked,
    ).toBe('unknown');
  });
});

describe('race-results-07: панель', () => {
  it('флаг и датчики — строгие', () => {
    expect(PanelAttemptFlag.parse({ code: 'HR_GAPS', metric: 12 })).toEqual({
      code: 'HR_GAPS',
      metric: 12,
    });
    expect(PanelAttemptFlag.safeParse({ code: 'HR_LOW', metric: 1 }).success).toBe(false);
    expect(AttemptSensors.safeParse({ hr: true }).success).toBe(false);
  });

  it('датчики: источник — отсчёты или признаки импорта; попытка до pass 2 без source — samples', () => {
    expect(ATTEMPT_SENSOR_SOURCES).toEqual(['samples', 'declared']);
    expect(AttemptSensors.parse({ hr: true, power: false })).toEqual({
      hr: true,
      power: false,
      source: 'samples',
    });
    expect(AttemptSensors.parse({ hr: true, power: false, source: 'declared' }).source).toBe(
      'declared',
    );
    expect(AttemptSensors.safeParse({ hr: true, power: false, source: 'file' }).success).toBe(
      false,
    );
  });

  it('PanelRaceStandingsQuery: group, attention=true; лишнее — ошибка', () => {
    expect(PanelRaceStandingsQuery.parse({})).toEqual({});
    expect(PanelRaceStandingsQuery.parse({ group: 'm_u40', attention: 'true' })).toEqual({
      group: 'm_u40',
      attention: 'true',
    });
    expect(PanelRaceStandingsQuery.safeParse({ attention: 'false' }).success).toBe(false);
    expect(PanelRaceStandingsQuery.safeParse({ limit: 1 }).success).toBe(false);
  });
});
