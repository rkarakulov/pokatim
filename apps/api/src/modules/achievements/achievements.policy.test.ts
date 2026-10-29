import { ACHIEVEMENT_CODES, type AchievementCode } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import type { RiderProtocolRow } from '../results';
import type { RiderRideFact } from '../rides';
import type { RiderRouteRideFact } from '../route-rides';
import {
  type AchievementFacts,
  earnedAchievements,
  type Earned,
  raceAchievements,
  reconcilePlan,
  sortForList,
  type StoredGrant,
} from './achievements.policy';

const day = (n: number) => new Date(Date.UTC(2026, 5, n, 8));
/** id вида `…000n`, упорядоченный как число (для детерминизма при равных датах). */
const id = (n: number) => `01890a5d-ac96-774b-bcce-${String(n).padStart(12, '0')}`;

const row = (
  race: number,
  at: number,
  place: number | null,
  extra: Partial<RiderProtocolRow> = {},
): RiderProtocolRow => ({
  raceId: id(race),
  place,
  tied: false,
  status: 'final',
  groupKey: 'm_u40',
  elapsedSec: 3600,
  startedAt: day(at),
  ...extra,
});
const routeRide = (route: number, at: number): RiderRouteRideFact => ({
  routeId: id(route),
  routeTitle: `Маршрут ${route}`,
  startedAt: day(at),
});
const ride = (n: number, at: number, extra: Partial<RiderRideFact> = {}): RiderRideFact => ({
  rideId: id(n),
  title: `Райд ${n}`,
  startsAt: day(at),
  organizer: false,
  goingCount: 3,
  ...extra,
});

const facts = (partial: Partial<AchievementFacts>): AchievementFacts => ({
  races: [],
  routes: [],
  rides: [],
  ...partial,
});
const earned = (partial: Partial<AchievementFacts>) => earnedAchievements(facts(partial));
const raceEarned = (n: number, at: number): Earned => ({
  object: { kind: 'race', id: id(n) },
  factAt: day(at),
  title: null,
});

describe('earnedAchievements — гонки (AC1)', () => {
  it('первый финиш, подиум, победа — самая ранняя подходящая строка; объект и дата факта', () => {
    const result = earned({
      races: [row(3, 12, 1), row(1, 10, 5), row(2, 11, 3)],
    });
    expect(result.get('race_first_finish')).toEqual(raceEarned(1, 10));
    expect(result.get('race_podium')).toEqual(raceEarned(2, 11));
    expect(result.get('race_win')).toEqual(raceEarned(3, 12));
    expect(result.has('races_5')).toBe(false);
  });

  it('DQ и строка без места не в зачёте; START в протокол не входит — фактов нет', () => {
    const result = earned({
      races: [
        row(1, 10, null, { status: 'dq' }),
        row(2, 11, 1, { status: 'dq' }),
        row(3, 12, null),
      ],
    });
    expect([...result.keys()]).toEqual([]);
    expect(earned({}).size).toBe(0);
  });

  it('место 4 — финиш без подиума; `=1` (ничья) — победа; статус `revised` в зачёте', () => {
    const fourth = earned({ races: [row(1, 10, 4)] });
    expect([...fourth.keys()]).toEqual(['race_first_finish']);
    const tied = earned({ races: [row(1, 10, 1, { tied: true, status: 'revised' })] });
    expect(tied.get('race_win')).toEqual(raceEarned(1, 10));
  });

  it('4 гонки — нет «Пять гонок»; 5 — есть, объект — 5-я по дате', () => {
    const four = [1, 2, 3, 4].map((n) => row(n, 10 + n, 10));
    expect(earned({ races: four }).has('races_5')).toBe(false);
    const five = [...four, row(9, 5, 7), row(5, 20, 8)];
    // по дате: 9 (5.06), 1, 2, 3, 4 (14.06) → 5-я — гонка 4
    expect(earned({ races: five }).get('races_5')).toEqual(raceEarned(4, 14));
  });

  it('равные даты — порядок по id гонки (детерминизм: объект не «прыгает» между сверками)', () => {
    const a = earned({ races: [row(7, 10, 2), row(3, 10, 1)] });
    const b = earned({ races: [row(3, 10, 1), row(7, 10, 2)] });
    expect(a.get('race_first_finish')).toEqual(raceEarned(3, 10));
    expect(b.get('race_first_finish')).toEqual(raceEarned(3, 10));
  });
});

describe('earnedAchievements — маршруты (AC1)', () => {
  it('первый маршрут — самый ранний заезд; название — из факта', () => {
    const result = earned({ routes: [routeRide(2, 12), routeRide(1, 10)] });
    expect(result.get('route_first')).toEqual({
      object: { kind: 'route', id: id(1) },
      factAt: day(10),
      title: 'Маршрут 1',
    });
  });

  it('повторные заезды того же маршрута — один маршрут, дата маршрута — ранний заезд', () => {
    const repeats = [1, 2, 3, 4, 5].map((n) => routeRide(1, 10 + n));
    expect(earned({ routes: repeats }).has('routes_5')).toBe(false);
    expect(earned({ routes: repeats }).get('route_first')?.factAt).toEqual(day(11));
  });

  it('4 маршрута — нет «Пять маршрутов»; 5 — 5-й маршрут по дате его первого заезда', () => {
    const four = [1, 2, 3, 4].map((n) => routeRide(n, 10 + n));
    expect(earned({ routes: four }).has('routes_5')).toBe(false);
    // маршрут 5 впервые — 20.06, повторно маршрут 1 — 25.06 (не меняет дату маршрута 1)
    const five = [...four, routeRide(5, 20), routeRide(1, 25)];
    expect(earned({ routes: five }).get('routes_5')).toEqual({
      object: { kind: 'route', id: id(5) },
      factAt: day(20),
      title: 'Маршрут 5',
    });
  });
});

describe('earnedAchievements — кофе-райды (AC1)', () => {
  it('первый кофе-райд — самый ранний (порт уже отдал только прошедшие опубликованные с «Иду»)', () => {
    const result = earned({ rides: [ride(2, 12), ride(1, 10)] });
    expect(result.get('ride_first')).toEqual({
      object: { kind: 'ride', id: id(1) },
      factAt: day(10),
      title: 'Райд 1',
    });
    expect(result.has('ride_organizer')).toBe(false);
  });

  it('организатор без других «Иду» (goingCount 1) — нет; с ещё одним (2) — есть, самый ранний такой', () => {
    const alone = earned({ rides: [ride(1, 10, { organizer: true, goingCount: 1 })] });
    expect(alone.has('ride_organizer')).toBe(false);
    expect(alone.has('ride_first')).toBe(true);
    const result = earned({
      rides: [
        ride(1, 10, { organizer: true, goingCount: 1 }),
        ride(3, 14, { organizer: true, goingCount: 5 }),
        ride(2, 12, { organizer: true, goingCount: 2 }),
      ],
    });
    expect(result.get('ride_organizer')?.object).toEqual({ kind: 'ride', id: id(2) });
  });

  it('9 райдов — нет «Десять»; 10 — объект и дата 10-го по дате', () => {
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ride(n, n));
    expect(earned({ rides: nine }).has('rides_10')).toBe(false);
    const ten = [...nine, ride(10, 20)];
    expect(earned({ rides: ten }).get('rides_10')).toEqual({
      object: { kind: 'ride', id: id(10) },
      factAt: day(20),
      title: 'Райд 10',
    });
  });
});

describe('raceAchievements (публичный список)', () => {
  it('только гоночные коды — те же правила', () => {
    const result = raceAchievements([row(1, 10, 1)]);
    expect([...result.keys()].sort()).toEqual(['race_first_finish', 'race_podium', 'race_win']);
  });
});

const NOW = new Date('2026-10-29T10:00:00Z');
const stored = (code: AchievementCode, partial: Partial<StoredGrant> = {}): StoredGrant => ({
  code,
  object: { kind: 'race', id: id(1) },
  factAt: day(10),
  seenAt: day(11),
  revokedAt: null,
  ...partial,
});

describe('reconcilePlan (A2–A4)', () => {
  const won = new Map<AchievementCode, Earned>([['race_win', raceEarned(1, 10)]]);

  it('первая сверка — вставка просмотренной (тихо, A3); последующая — непросмотренной', () => {
    expect(reconcilePlan([], won, true, NOW)).toEqual([
      { type: 'insert', code: 'race_win', earned: raceEarned(1, 10), seenAt: NOW },
    ]);
    expect(reconcilePlan([], won, false, NOW)).toEqual([
      { type: 'insert', code: 'race_win', earned: raceEarned(1, 10), seenAt: null },
    ]);
  });

  it('факт пропал — отзыв видимой; уже отозванная — ничего', () => {
    expect(reconcilePlan([stored('race_win')], new Map(), false, NOW)).toEqual([
      { type: 'revoke', code: 'race_win' },
    ]);
    expect(
      reconcilePlan([stored('race_win', { revokedAt: day(12) })], new Map(), false, NOW),
    ).toEqual([]);
  });

  it('факт вернулся — восстановление с новым объектом (`seenAt` не в плане)', () => {
    const back = new Map<AchievementCode, Earned>([['race_win', raceEarned(2, 15)]]);
    expect(reconcilePlan([stored('race_win', { revokedAt: day(12) })], back, false, NOW)).toEqual([
      { type: 'restore', code: 'race_win', earned: raceEarned(2, 15) },
    ]);
  });

  it('видимая запись, объект или дата сменились — обновление (Подиум переходит на другую гонку после DQ)', () => {
    const moved = new Map<AchievementCode, Earned>([['race_podium', raceEarned(2, 15)]]);
    expect(reconcilePlan([stored('race_podium')], moved, false, NOW)).toEqual([
      { type: 'refresh', code: 'race_podium', earned: raceEarned(2, 15) },
    ]);
    const sameObjectNewDate = new Map<AchievementCode, Earned>([
      ['race_podium', raceEarned(1, 16)],
    ]);
    expect(reconcilePlan([stored('race_podium')], sameObjectNewDate, false, NOW)).toEqual([
      { type: 'refresh', code: 'race_podium', earned: raceEarned(1, 16) },
    ]);
  });

  it('устойчивое состояние — пустой план (в том числе на первой сверке после сбоя маркера)', () => {
    expect(reconcilePlan([stored('race_win')], won, false, NOW)).toEqual([]);
    expect(reconcilePlan([stored('race_win')], won, true, NOW)).toEqual([]);
    expect(reconcilePlan([], new Map(), true, NOW)).toEqual([]);
  });
});

describe('sortForList (A8)', () => {
  it('от новых фактов к старым; равные даты — порядок каталога ↓', () => {
    const items = [
      { code: 'race_first_finish' as const, factAt: day(10) },
      { code: 'route_first' as const, factAt: day(12) },
      { code: 'race_win' as const, factAt: day(10) },
      { code: 'race_podium' as const, factAt: day(10) },
    ];
    expect(sortForList(items).map((item) => item.code)).toEqual([
      'route_first',
      'race_win',
      'race_podium',
      'race_first_finish',
    ]);
  });

  it('каталог правил исчерпывающий', () => {
    const all = earned({
      races: [1, 2, 3, 4, 5].map((n) => row(n, n, 1)),
      routes: [1, 2, 3, 4, 5].map((n) => routeRide(n, n)),
      rides: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ride(n, n, { organizer: true })),
    });
    expect([...all.keys()].sort()).toEqual([...ACHIEVEMENT_CODES].sort());
  });
});
