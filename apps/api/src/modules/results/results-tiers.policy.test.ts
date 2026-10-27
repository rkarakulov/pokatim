import { ATTEMPT_FLAG_CODES, ATTEMPT_SENSOR_SOURCES } from '@pokatim/contracts';
import { SENSOR_FLAG_CODES, SENSOR_SOURCES } from '@pokatim/tracks/parse';
import { describe, expect, it } from 'vitest';

import type { RaceForResults } from '../races';
import type { AttemptSegmentDoc, RaceAttemptDoc, RaceEntryDoc } from './results.collection';
import {
  allowedGroups,
  buildProtocol,
  entryActions,
  needsVerifiedProfile,
  ownGroup,
  pickBest,
  planEntryChange,
  type ProtocolBase,
  raceYear,
  rankRule,
  resultStatus,
  speedClusterFlags,
  unrankedOf,
} from './results.policy';

/*
 * race-results-07: группы пол × возраст, матрица заявки (RC-1…RC-3), правило мест и лучший результат с пульсом,
 * «Финишёр», флаг кластера скорости, протокол по группам.
 */

const at = (iso: string) => new Date(iso);
const ENDS = at('2026-10-26T20:59:00Z');

const race = (overrides: Partial<RaceForResults> = {}): RaceForResults => ({
  id: 'race',
  ownerUserId: 'owner',
  status: 'published',
  title: 'Коридор',
  windowStartsAt: at('2026-10-23T21:00:00Z'),
  windowEndsAt: ENDS,
  closesAt: new Date(ENDS.getTime() + 60_000),
  protocolPlannedAt: new Date(ENDS.getTime() + 48 * 3_600_000),
  corridor: { routeId: 'route', widthM: 50, distanceM: 8000 },
  lockedAt: null,
  groupScheme: 'gender_age',
  protocolPublishedAt: null,
  disputeFilingClosedAt: null,
  ...overrides,
});

describe('группы пол × возраст', () => {
  it('год гонки — год конца окна по Минску (переход года)', () => {
    // 31.12 23:59 Минска = 20:59 UTC — ещё 2026; 01.01 00:30 Минска = 31.12 21:30 UTC — уже 2027
    expect(raceYear(race({ windowEndsAt: at('2026-12-31T20:59:00Z') }))).toBe(2026);
    expect(raceYear(race({ windowEndsAt: at('2026-12-31T21:30:00Z') }))).toBe(2027);
  });

  it('возраст на 31.12 года гонки: границы 39/40, 49/50', () => {
    const r = race();
    expect(ownGroup('m', 2026 - 39, r)).toBe('m_u40');
    expect(ownGroup('m', 2026 - 40, r)).toBe('m_40_49');
    expect(ownGroup('m', 2026 - 49, r)).toBe('m_40_49');
    expect(ownGroup('m', 2026 - 50, r)).toBe('m_50p');
    expect(ownGroup('w', 2026 - 18, r)).toBe('w_u40');
    expect(ownGroup('w', 2026 - 45, r)).toBe('w_40_49');
    expect(ownGroup('w', 2026 - 70, r)).toBe('w_50p');
    // тот же райдер в гонке с окном, кончающимся в новом году, — на год старше
    expect(ownGroup('m', 1987, race({ windowEndsAt: at('2026-12-31T20:59:00Z') }))).toBe('m_u40');
    expect(ownGroup('m', 1987, race({ windowEndsAt: at('2026-12-31T21:30:00Z') }))).toBe('m_40_49');
  });

  it('разрешённые группы: своя первой, затем младшие своего пола', () => {
    expect(allowedGroups('m_50p')).toEqual(['m_50p', 'm_40_49', 'm_u40']);
    expect(allowedGroups('w_40_49')).toEqual(['w_40_49', 'w_u40']);
    expect(allowedGroups('m_u40')).toEqual(['m_u40']);
  });
});

describe('planEntryChange — матрица заявки', () => {
  const profile = { gender: 'm' as const, birthYear: 1980 }; // 46 → m_40_49
  const plan = (input: Partial<Parameters<typeof planEntryChange>[0]>) =>
    planEntryChange({
      scheme: 'gender_age',
      phase: 'open',
      existing: null,
      request: {},
      profile,
      race: race(),
      ...input,
    });
  const verified = {
    status: 'active' as const,
    tier: 'verified' as const,
    groupKey: 'm_40_49' as const,
  };
  const start = { status: 'active' as const, tier: 'start' as const, groupKey: 'overall' as const };

  it('схема overall (RC-1): уровень не выбирается — verified/overall; группа ≠ overall — 422; повтор — noop', () => {
    expect(plan({ scheme: 'overall', profile: null })).toEqual({
      kind: 'create',
      tier: 'verified',
      groupKey: 'overall',
    });
    expect(plan({ scheme: 'overall', request: { tier: 'start' } })).toMatchObject({
      kind: 'create',
      tier: 'verified',
    });
    expect(plan({ scheme: 'overall', request: { groupKey: 'm_u40' } })).toEqual({
      kind: 'error',
      code: 'RESULT_GROUP_NOT_ALLOWED',
    });
    expect(
      plan({ scheme: 'overall', existing: { ...verified, groupKey: 'overall' } }),
    ).toMatchObject({ kind: 'noop' });
  });

  it('новая заявка: пусто и start — START/overall; группа у START ≠ overall — 422', () => {
    expect(plan({ profile: null })).toEqual({ kind: 'create', tier: 'start', groupKey: 'overall' });
    expect(plan({ request: { tier: 'start', groupKey: 'overall' } })).toMatchObject({
      tier: 'start',
    });
    expect(plan({ request: { tier: 'start', groupKey: 'm_u40' } })).toEqual({
      kind: 'error',
      code: 'RESULT_GROUP_NOT_ALLOWED',
    });
  });

  it('новая Verified: без анкеты — 409; своя по умолчанию; младшая — ок; старшая, чужой пол, overall — 422', () => {
    expect(plan({ request: { tier: 'verified' }, profile: null })).toEqual({
      kind: 'error',
      code: 'VERIFIED_PROFILE_REQUIRED',
    });
    expect(plan({ request: { tier: 'verified' } })).toEqual({
      kind: 'create',
      tier: 'verified',
      groupKey: 'm_40_49',
    });
    expect(plan({ request: { tier: 'verified', groupKey: 'm_u40' } })).toMatchObject({
      groupKey: 'm_u40',
    });
    for (const groupKey of ['m_50p', 'w_40_49', 'w_u40', 'overall'] as const) {
      expect(plan({ request: { tier: 'verified', groupKey } })).toEqual({
        kind: 'error',
        code: 'RESULT_GROUP_NOT_ALLOWED',
      });
    }
  });

  it('существующая: без tier — noop (RC-2); та же группа — noop; Verified → START и смена группы — 409 (RC-3)', () => {
    expect(plan({ existing: start })).toMatchObject({ kind: 'noop' });
    expect(plan({ existing: verified, request: { groupKey: 'm_u40' } })).toMatchObject({
      kind: 'noop',
    });
    expect(plan({ existing: verified, request: { tier: 'verified' } })).toMatchObject({
      kind: 'noop',
    });
    expect(
      plan({ existing: verified, request: { tier: 'verified', groupKey: 'm_40_49' } }),
    ).toMatchObject({ kind: 'noop' });
    expect(plan({ existing: verified, request: { tier: 'start' } })).toEqual({
      kind: 'error',
      code: 'RACE_TIER_LOCKED',
    });
    expect(plan({ existing: verified, request: { tier: 'verified', groupKey: 'm_u40' } })).toEqual({
      kind: 'error',
      code: 'RACE_TIER_LOCKED',
    });
    expect(plan({ existing: start, request: { tier: 'start' } })).toMatchObject({ kind: 'noop' });
    // заявка до 07 (tier: null) — Verified
    expect(
      plan({ existing: { ...verified, tier: null }, request: { tier: 'start' } }),
    ).toMatchObject({ code: 'RACE_TIER_LOCKED' });
  });

  it('повышение START → Verified: в upcoming/open — upgrade; после окна — 409; без анкеты — 409; группа — как у новой', () => {
    expect(plan({ existing: start, request: { tier: 'verified' } })).toEqual({
      kind: 'upgrade',
      tier: 'verified',
      groupKey: 'm_40_49',
    });
    expect(
      plan({ existing: start, phase: 'upcoming', request: { tier: 'verified' } }),
    ).toMatchObject({ kind: 'upgrade' });
    for (const phase of ['closed', 'final', 'cancelled'] as const) {
      expect(plan({ existing: start, phase, request: { tier: 'verified' } })).toEqual({
        kind: 'error',
        code: 'RACE_TIER_LOCKED',
      });
    }
    expect(plan({ existing: start, request: { tier: 'verified' }, profile: null })).toEqual({
      kind: 'error',
      code: 'VERIFIED_PROFILE_REQUIRED',
    });
    expect(
      plan({ existing: start, request: { tier: 'verified', groupKey: 'm_50p' } }),
    ).toMatchObject({ code: 'RESULT_GROUP_NOT_ALLOWED' });
  });

  it('анкета нужна только для создания или повышения Verified в gender_age', () => {
    const needs = (input: Partial<Parameters<typeof needsVerifiedProfile>[0]>) =>
      needsVerifiedProfile({ scheme: 'gender_age', existing: null, request: {}, ...input });
    expect(needs({ request: { tier: 'verified' } })).toBe(true);
    expect(needs({ existing: start, request: { tier: 'verified' } })).toBe(true);
    expect(needs({})).toBe(false);
    expect(needs({ existing: verified, request: { tier: 'verified' } })).toBe(false);
    expect(needs({ scheme: 'overall', request: { tier: 'verified' } })).toBe(false);
  });
});

describe('правило мест и лучший результат', () => {
  const segment = (elapsedSec: number): AttemptSegmentDoc => ({
    startedAt: at('2026-10-25T08:00:00Z'),
    finishedAt: new Date(at('2026-10-25T08:00:00Z').getTime() + elapsedSec * 1000),
    elapsedMs: elapsedSec * 1000,
    elapsedSec,
    distanceM: 8000,
    offCorridorM: 0,
    offCorridorShare: 0,
    maxExcursionM: 0,
    coverage: 1,
    noisePoints: 0,
  });
  type A = Pick<RaceAttemptDoc, '_id' | 'status' | 'segment' | 'sensors' | 'flags'>;
  const attempt = (id: string, elapsedSec: number, hr: boolean | null): A => ({
    _id: id,
    status: 'counted',
    segment: segment(elapsedSec),
    sensors: hr === null ? undefined : { hr, power: false },
    flags: hr ? [{ code: 'HR_GAPS', metric: 12 }] : [],
  });

  it('rankRule: START — none; overall — all; группа пол × возраст — heart_rate', () => {
    expect(rankRule({ tier: 'start', groupKey: 'overall' })).toBe('none');
    expect(rankRule({ tier: 'verified', groupKey: 'overall' })).toBe('all');
    expect(rankRule({ tier: null, groupKey: 'overall' })).toBe('all');
    expect(rankRule({ tier: 'verified', groupKey: 'w_50p' })).toBe('heart_rate');
  });

  it('pickBest heart_rate: лучшая с пульсом, даже медленнее (ranked); без пульса — лучшая, ranked: false', () => {
    const attempts = [attempt('fast', 3000, false), attempt('slow', 3600, true)];
    expect(pickBest(attempts, 'heart_rate')).toMatchObject({
      attemptId: 'slow',
      elapsedSec: 3600,
      ranked: true,
      flags: [{ code: 'HR_GAPS', metric: 12 }],
    });
    expect(
      pickBest([attempt('fast', 3000, false), attempt('old', 2900, null)], 'heart_rate'),
    ).toMatchObject({
      attemptId: 'old',
      ranked: false,
      flags: [],
    });
  });

  it('pickBest: all — лучшая, ranked; none (START) — лучшая, не ranked; нет засчитанных — null', () => {
    const attempts = [attempt('fast', 3000, false), attempt('slow', 3600, true)];
    expect(pickBest(attempts, 'all')).toMatchObject({ attemptId: 'fast', ranked: true });
    expect(pickBest(attempts, 'none')).toMatchObject({ attemptId: 'fast', ranked: false });
    expect(pickBest([{ ...attempt('x', 1, true), status: 'rejected' }], 'all')).toBeNull();
  });

  const entry = (
    overrides: Partial<
      Pick<RaceEntryDoc, 'status' | 'best' | 'summary' | 'disqualified' | 'tier'>
    > = {},
  ) => ({
    status: 'active' as const,
    best: null,
    tier: 'verified' as const,
    summary: { total: 1, pending: 0, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 },
    disqualified: null,
    ...overrides,
  });
  const best = (ranked?: boolean) => ({
    attemptId: 'a',
    elapsedSec: 60,
    startedAt: ENDS,
    finishedAt: ENDS,
    flags: [],
    ...(ranked === undefined ? {} : { ranked }),
  });
  const now = at('2026-10-25T12:00:00Z');

  it('resultStatus: best без места — finisher (и после публикации); заявка до 07 без ranked — provisional', () => {
    expect(resultStatus(entry({ best: best(false) }), race(), now)).toBe('finisher');
    expect(
      resultStatus(entry({ best: best(false) }), race({ protocolPublishedAt: now }), now, {
        ignoreBest: true,
      }),
    ).toBe('finisher');
    expect(resultStatus(entry({ best: best(true) }), race(), now)).toBe('provisional');
    expect(resultStatus(entry({ best: best() }), race(), now)).toBe('provisional');
    expect(resultStatus(entry({ status: 'withdrawn', best: best(false) }), race(), now)).toBe(
      'withdrawn',
    );
  });

  it('unrankedOf: START — start, Verified без пульса — no_heart_rate, с местом и без лучшего — null', () => {
    expect(unrankedOf(entry({ tier: 'start', best: best(false) }))).toBe('start');
    expect(unrankedOf(entry({ best: best(false) }))).toBe('no_heart_rate');
    expect(unrankedOf(entry({ best: best(true) }))).toBeNull();
    expect(unrankedOf(entry({ best: best() }))).toBeNull();
    expect(unrankedOf(entry())).toBeNull();
  });

  it('entryActions.canUpgrade: активная START, окно upcoming/open, схема gender_age', () => {
    const start = { ...entry({ tier: 'start' }) };
    const actions = (r: RaceForResults, phase: 'open' | 'closed', e: typeof start | null) =>
      entryActions(r, phase, e, now, { openDisputes: 0 }).canUpgrade;
    expect(actions(race(), 'open', start)).toBe(true);
    expect(actions(race(), 'closed', start)).toBe(false);
    expect(actions(race({ groupScheme: 'overall' }), 'open', start)).toBe(false);
    expect(actions(race(), 'open', entry())).toBe(false);
    expect(actions(race(), 'open', null)).toBe(false);
    expect(actions(race(), 'open', { ...start, status: 'withdrawn' })).toBe(false);
  });
});

describe('SPEED_CLUSTER_HIGH', () => {
  const row = (entryId: string, groupKey: ProtocolBase['groupKey'], elapsedSec: number) => ({
    entryId,
    groupKey,
    elapsedSec,
  });

  it('сторож: коды флагов датчиков — подмножество ATTEMPT_FLAG_CODES', () => {
    for (const code of SENSOR_FLAG_CODES) expect(ATTEMPT_FLAG_CODES).toContain(code);
  });

  it('сторож: источники датчиков движка = ATTEMPT_SENSOR_SOURCES контракта', () => {
    expect([...SENSOR_SOURCES]).toEqual([...ATTEMPT_SENSOR_SOURCES]);
  });

  it('(а) группа из 5: время < 0,80 медианы — флаг; ровно 0,80 — нет; группа из 4 — нет', () => {
    // медиана 1000: 799 → 0,799 — флаг; 800 → 0,80 — нет (m_u40 — правило (б) не действует)
    const five = [
      row('a', 'm_u40', 799),
      row('b', 'm_u40', 1000),
      row('c', 'm_u40', 1000),
      row('d', 'm_u40', 1100),
      row('e', 'm_u40', 1200),
    ];
    expect([...speedClusterFlags(five)]).toEqual([
      ['a', { code: 'SPEED_CLUSTER_HIGH', metric: 0.799 }],
    ]);
    const exact = five.map((r) => (r.entryId === 'a' ? { ...r, elapsedSec: 800 } : r));
    expect(speedClusterFlags(exact).size).toBe(0);
    // 4 строки в группе — (а) не действует
    expect(speedClusterFlags(five.slice(0, 4)).size).toBe(0);
  });

  it('(а) медиана чётной группы — среднее двух средних; в группе overall тоже действует', () => {
    const six = [
      row('a', 'overall', 700),
      row('b', 'overall', 900),
      row('c', 'overall', 1000),
      row('d', 'overall', 1000),
      row('e', 'overall', 1100),
      row('f', 'overall', 1200),
    ];
    // медиана (1000 + 1000) / 2 = 1000 → 0,7
    expect(speedClusterFlags(six).get('a')).toEqual({ code: 'SPEED_CLUSTER_HIGH', metric: 0.7 });
  });

  it('(б) лучшее время гонки ≥ 5 строк — у женщины или не m_u40: флаг (метрика — к медиане своей группы); у m_u40 — нет', () => {
    const base = [
      row('m1', 'm_u40', 1100),
      row('m2', 'm_u40', 1200),
      row('m3', 'm_u40', 1300),
      row('m4', 'm_u40', 1400),
    ];
    const woman = speedClusterFlags([...base, row('w', 'w_u40', 1000)]);
    expect([...woman]).toEqual([['w', { code: 'SPEED_CLUSTER_HIGH', metric: 1 }]]);
    expect([...speedClusterFlags([...base, row('v', 'm_40_49', 1000)]).keys()]).toEqual(['v']);
    expect(speedClusterFlags([...base, row('y', 'm_u40', 1000)]).size).toBe(0);
    // 4 строки в гонке — (б) не действует
    expect(speedClusterFlags([...base.slice(0, 3), row('w', 'w_u40', 1000)]).size).toBe(0);
    // ничья лучших: флаг у обоих не-m_u40
    const tie = speedClusterFlags([...base, row('w', 'w_u40', 1000), row('v', 'm_50p', 1000)]);
    expect([...tie.keys()].sort()).toEqual(['v', 'w']);
  });
});

describe('buildProtocol по группам', () => {
  const t = at('2026-10-25T08:00:00Z');
  const base = (
    entryId: string,
    groupKey: ProtocolBase['groupKey'],
    elapsedSec: number,
    dq = false,
  ): ProtocolBase => ({
    entryId,
    userId: `u-${entryId}`,
    attemptId: `a-${entryId}`,
    elapsedSec,
    startedAt: t,
    dq,
    groupKey,
    flags: entryId === 'g1' ? [{ code: 'HR_GAPS', metric: 15 }] : [],
  });

  it('группы по порядку справочника, места внутри группы, DQ — в конце своей группы, order сквозной, флаги в строке', () => {
    const rows = buildProtocol(
      [
        base('w1', 'w_u40', 1500),
        base('g1', 'm_40_49', 1200),
        base('g2', 'm_40_49', 1100, true),
        base('m1', 'm_u40', 1000),
        base('m2', 'm_u40', 1100),
        base('m3', 'm_u40', 1100),
        base('m4', 'm_u40', 1200),
      ],
      null,
    );
    expect(rows.map((r) => [r.order, r.entryId, r.groupKey, r.place, r.tied, r.status])).toEqual([
      [0, 'm1', 'm_u40', 1, false, 'final'],
      [1, 'm2', 'm_u40', 2, true, 'final'],
      [2, 'm3', 'm_u40', 2, true, 'final'],
      [3, 'm4', 'm_u40', 4, false, 'final'],
      [4, 'g1', 'm_40_49', 1, false, 'final'],
      [5, 'g2', 'm_40_49', null, false, 'dq'],
      [6, 'w1', 'w_u40', 1, false, 'final'],
    ]);
    expect(rows.find((r) => r.entryId === 'g1')?.flags).toEqual([{ code: 'HR_GAPS', metric: 15 }]);
  });

  it('флаг скорости — по строкам ревизии (не DQ), датчики — из базы; DQ-строка флаг скорости не получает', () => {
    const rows = buildProtocol(
      [
        base('a', 'm_u40', 700),
        base('b', 'm_u40', 1000),
        base('c', 'm_u40', 1000),
        base('d', 'm_u40', 1100),
        base('e', 'm_u40', 1200),
        base('g1', 'm_u40', 600, true),
      ],
      null,
    );
    expect(rows.find((r) => r.entryId === 'a')?.flags).toEqual([
      { code: 'SPEED_CLUSTER_HIGH', metric: 0.7 },
    ]);
    expect(rows.find((r) => r.entryId === 'g1')?.flags).toEqual([{ code: 'HR_GAPS', metric: 15 }]);
  });
});
