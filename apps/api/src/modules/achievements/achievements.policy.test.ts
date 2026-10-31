import { minskToday } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import type { RiderProtocolRow } from '../results';
import type { RiderRideFact } from '../rides';
import type { RiderRouteRideFact } from '../route-rides';
import type { RiderSeasonOutcome, RiderSeasonRow } from '../standings';
import {
  type AchievementFacts,
  earnedAchievements,
  type Earned,
  evaluateAchievements,
  FACT_ACHIEVEMENT_CODES,
  type FactAchievementCode,
  isSeen,
  type LevelRank,
  levelName,
  noticeDue,
  raceAchievements,
  reconcilePlan,
  SEASONAL_RULES,
  seasonalAchievements,
  type SeasonalEarned,
  seasonalKey,
  seasonalPlan,
  sortForList,
  type StoredGrant,
  type StoredSeasonGrant,
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
const raceEarned = (n: number, at: number, level: LevelRank | null = null): Earned => ({
  object: { kind: 'race', id: id(n) },
  factAt: day(at),
  title: null,
  level,
});
/** n гонок «в зачёте» по одной в день: гонка k — день k. */
const races = (n: number) => Array.from({ length: n }, (_, k) => row(k + 1, k + 1, 10));
const routes = (n: number) => Array.from({ length: n }, (_, k) => routeRide(k + 1, k + 1));
const rides = (n: number) => Array.from({ length: n }, (_, k) => ride(k + 1, k + 1));

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

  it('4 гонки — нет «Гонщика»; 5 — бронза, объект — 5-я по дате', () => {
    const four = [1, 2, 3, 4].map((n) => row(n, 10 + n, 10));
    expect(earned({ races: four }).has('races_5')).toBe(false);
    const five = [...four, row(9, 5, 7), row(5, 20, 8)];
    // по дате: 9 (5.06), 1, 2, 3, 4 (14.06) → 5-я — гонка 4
    expect(earned({ races: five }).get('races_5')).toEqual(raceEarned(4, 14, 1));
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
      level: null,
    });
  });

  it('повторные заезды того же маршрута — один маршрут, дата маршрута — ранний заезд', () => {
    const repeats = [1, 2, 3, 4, 5].map((n) => routeRide(1, 10 + n));
    expect(earned({ routes: repeats }).has('routes_5')).toBe(false);
    expect(earned({ routes: repeats }).get('route_first')?.factAt).toEqual(day(11));
  });

  it('4 маршрута — нет «Путешественника»; 5 — 5-й маршрут по дате его первого заезда', () => {
    const four = [1, 2, 3, 4].map((n) => routeRide(n, 10 + n));
    expect(earned({ routes: four }).has('routes_5')).toBe(false);
    // маршрут 5 впервые — 20.06, повторно маршрут 1 — 25.06 (не меняет дату маршрута 1)
    const five = [...four, routeRide(5, 20), routeRide(1, 25)];
    expect(earned({ routes: five }).get('routes_5')).toEqual({
      object: { kind: 'route', id: id(5) },
      factAt: day(20),
      title: 'Маршрут 5',
      level: 1,
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
      level: null,
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
      level: 1,
    });
  });
});

describe('уровни счётных (L1, L2, AC1)', () => {
  const level = (partial: Partial<AchievementFacts>, code: FactAchievementCode) =>
    earned(partial).get(code)?.level ?? null;

  it('гонки: 4 → нет, 5 → бронза, 14 → бронза, 15 → серебро, 29 → серебро, 30 → золото', () => {
    expect([4, 5, 14, 15, 29, 30, 45].map((n) => level({ races: races(n) }, 'races_5'))).toEqual([
      null,
      1,
      1,
      2,
      2,
      3,
      3,
    ]);
  });

  it('объект и дата — факт порога текущего уровня (15-я / 30-я гонка по дате, L2)', () => {
    expect(earned({ races: races(20) }).get('races_5')).toEqual(raceEarned(15, 15, 2));
    expect(earned({ races: races(31) }).get('races_5')).toEqual(raceEarned(30, 30, 3));
  });

  it('DQ не в зачёте: 15 строк, одна DQ — бронза', () => {
    const rows = races(15).map((r, k) => (k === 3 ? { ...r, status: 'dq' as const } : r));
    expect(level({ races: rows }, 'races_5')).toBe(1);
  });

  it('маршруты: 14 → бронза, 15 → серебро (15-й маршрут по первому заезду); повторы не считаются', () => {
    expect(level({ routes: routes(14) }, 'routes_5')).toBe(1);
    expect(earned({ routes: routes(15) }).get('routes_5')).toEqual({
      object: { kind: 'route', id: id(15) },
      factAt: day(15),
      title: 'Маршрут 15',
      level: 2,
    });
    const repeats = [...routes(14), routeRide(1, 20), routeRide(2, 21)];
    expect(level({ routes: repeats }, 'routes_5')).toBe(1);
    expect(level({ routes: routes(30) }, 'routes_5')).toBe(3);
  });

  it('кофе-райды: 9/10, 24/25, 49/50', () => {
    expect([9, 10, 24, 25, 49, 50].map((n) => level({ rides: rides(n) }, 'rides_10'))).toEqual([
      null,
      1,
      1,
      2,
      2,
      3,
    ]);
    expect(earned({ rides: rides(25) }).get('rides_10')?.object).toEqual({
      kind: 'ride',
      id: id(25),
    });
  });

  it('разовые — `level: null`', () => {
    const all = earned({ races: races(30), routes: routes(30), rides: rides(50) });
    for (const [code, item] of all) {
      if (!['races_5', 'routes_5', 'rides_10'].includes(code)) expect(item.level, code).toBeNull();
    }
  });

  it('levelName: ранг → строка контракта', () => {
    expect(([1, 2, 3] as const).map(levelName)).toEqual(['bronze', 'silver', 'gold']);
  });
});

describe('evaluateAchievements — прогресс (L4, AC4)', () => {
  const progress = (partial: Partial<AchievementFacts>) =>
    evaluateAchievements(facts(partial)).progress;

  it('счёт 0 — нет строки; 2 гонки — бронза 2/5; 7 — серебро 7/15; 29 — золото 29/30; 30 — нет', () => {
    expect(progress({})).toEqual([]);
    expect(progress({ races: races(2) })).toEqual([
      { code: 'races_5', level: 1, current: 2, target: 5 },
    ]);
    expect(progress({ races: races(7) })).toEqual([
      { code: 'races_5', level: 2, current: 7, target: 15 },
    ]);
    expect(progress({ races: races(29) })).toEqual([
      { code: 'races_5', level: 3, current: 29, target: 30 },
    ]);
    expect(progress({ races: races(30) })).toEqual([]);
  });

  it('порядок каталога; счёт — разные маршруты и прошедшие райды', () => {
    expect(
      progress({
        rides: rides(12),
        routes: [...routes(3), routeRide(1, 30)],
        races: races(15),
      }),
    ).toEqual([
      { code: 'races_5', level: 3, current: 15, target: 30 },
      { code: 'routes_5', level: 1, current: 3, target: 5 },
      { code: 'rides_10', level: 2, current: 12, target: 25 },
    ]);
  });

  it('earned — тот же результат, что `earnedAchievements`', () => {
    const input = facts({ races: races(16), rides: rides(3) });
    expect(evaluateAchievements(input).earned).toEqual(earnedAchievements(input));
  });
});

describe('raceAchievements (публичный список)', () => {
  it('только гоночные коды — те же правила', () => {
    const result = raceAchievements([row(1, 10, 1)]);
    expect([...result.keys()].sort()).toEqual(['race_first_finish', 'race_podium', 'race_win']);
  });

  it('уровень гоночного `races_5` (L7)', () => {
    expect(raceAchievements(races(16)).get('races_5')?.level).toBe(2);
  });
});

describe('isSeen (L3)', () => {
  it('документ v1 без полей — по `seenAt` (бронза)', () => {
    expect(isSeen({ seenAt: day(1) }, 1)).toBe(true);
    expect(isSeen({ seenAt: null }, 1)).toBe(false);
    expect(isSeen({ seenAt: day(1) }, null)).toBe(true);
  });

  it('показанный уровень ниже текущего — не показано; выше или равен — показано', () => {
    expect(isSeen({ seenAt: day(1), seenLevel: 1 }, 2)).toBe(false);
    expect(isSeen({ seenAt: day(1), seenLevel: 2 }, 2)).toBe(true);
    expect(isSeen({ seenAt: day(1), seenLevel: 3 }, 2)).toBe(true);
    expect(isSeen({ seenAt: null, seenLevel: 3 }, 1)).toBe(false);
  });

  it('null-уровни ≡ 1 (разовые и v1)', () => {
    expect(isSeen({ seenAt: day(1), seenLevel: null }, null)).toBe(true);
    expect(isSeen({ seenAt: day(1), seenLevel: null }, 2)).toBe(false);
  });
});

describe('noticeDue (P1, P3, L3)', () => {
  const at = day(1);

  it('новый уровень выше объявленного и не показан — уведомление', () => {
    // вставлено после первой сверки на бронзе (объявлено 1), бронза ещё не показана → серебро
    expect(noticeDue({ seenAt: null, level: 1, notifiedLevel: 1 }, 2)).toBe(true);
    // бронза показана → серебро
    expect(noticeDue({ seenAt: at, seenLevel: 1, level: 1, notifiedLevel: 1 }, 2)).toBe(true);
    expect(noticeDue({ seenAt: at, seenLevel: 2, level: 2, notifiedLevel: 2 }, 3)).toBe(true);
  });

  it('понижение, тот же уровень (смена объекта или даты) — тихо', () => {
    expect(noticeDue({ seenAt: at, seenLevel: 2, level: 2, notifiedLevel: 2 }, 1)).toBe(false);
    expect(noticeDue({ seenAt: null, level: 2, notifiedLevel: 2 }, 2)).toBe(false);
  });

  it('возврат на показанный уровень — тихо (L3)', () => {
    // серебро показано, понижено до бронзы (объявлено 2 нет — первая сверка на серебре), снова серебро
    expect(noticeDue({ seenAt: at, seenLevel: 2, level: 1, notifiedLevel: 1 }, 2)).toBe(false);
  });

  it('возврат на уже объявленный уровень — тихо (бронза → серебро → бронза → серебро)', () => {
    expect(noticeDue({ seenAt: null, level: 1, notifiedLevel: 2 }, 2)).toBe(false);
  });

  it('документ до выката без notifiedLevel ≡ сохранённый уровень (ретро нет)', () => {
    expect(noticeDue({ seenAt: null, level: 2 }, 2)).toBe(false);
    expect(noticeDue({ seenAt: null }, 1)).toBe(false);
    expect(noticeDue({ seenAt: at, seenLevel: 1, level: 1 }, 2)).toBe(true);
    expect(noticeDue({ seenAt: null, level: 2, notifiedLevel: null }, 3)).toBe(true);
  });

  it('разовые (уровень null) — восстановление тихое', () => {
    expect(noticeDue({ seenAt: null, level: null, notifiedLevel: null }, null)).toBe(false);
    expect(noticeDue({ seenAt: at, level: null }, null)).toBe(false);
  });
});

const NOW = new Date('2026-10-29T10:00:00Z');
const stored = (code: FactAchievementCode, partial: Partial<StoredGrant> = {}): StoredGrant => ({
  code,
  object: { kind: 'race', id: id(1) },
  factAt: day(10),
  seenAt: day(11),
  revokedAt: null,
  ...partial,
});

describe('reconcilePlan (A2–A4)', () => {
  const won = new Map<FactAchievementCode, Earned>([['race_win', raceEarned(1, 10)]]);

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
    const back = new Map<FactAchievementCode, Earned>([['race_win', raceEarned(2, 15)]]);
    expect(reconcilePlan([stored('race_win', { revokedAt: day(12) })], back, false, NOW)).toEqual([
      { type: 'restore', code: 'race_win', earned: raceEarned(2, 15) },
    ]);
  });

  it('видимая запись, объект или дата сменились — обновление (Подиум переходит на другую гонку после DQ)', () => {
    const moved = new Map<FactAchievementCode, Earned>([['race_podium', raceEarned(2, 15)]]);
    expect(reconcilePlan([stored('race_podium')], moved, false, NOW)).toEqual([
      { type: 'refresh', code: 'race_podium', earned: raceEarned(2, 15) },
    ]);
    const sameObjectNewDate = new Map<FactAchievementCode, Earned>([
      ['race_podium', raceEarned(1, 16)],
    ]);
    expect(reconcilePlan([stored('race_podium')], sameObjectNewDate, false, NOW)).toEqual([
      { type: 'refresh', code: 'race_podium', earned: raceEarned(1, 16) },
    ]);
  });

  it('уровень вырос или упал — обновление; документ v1 на бронзе — пустой план', () => {
    const silver = new Map<FactAchievementCode, Earned>([['races_5', raceEarned(15, 15, 2)]]);
    expect(
      reconcilePlan(
        [stored('races_5', { object: raceEarned(5, 5).object, factAt: day(5) })],
        silver,
        false,
        NOW,
      ),
    ).toEqual([{ type: 'refresh', code: 'races_5', earned: raceEarned(15, 15, 2) }]);
    const bronze = new Map<FactAchievementCode, Earned>([['races_5', raceEarned(5, 5, 1)]]);
    const atSilver = stored('races_5', {
      object: raceEarned(15, 15).object,
      factAt: day(15),
      level: 2,
    });
    expect(reconcilePlan([atSilver], bronze, false, NOW)).toEqual([
      { type: 'refresh', code: 'races_5', earned: raceEarned(5, 5, 1) },
    ]);
    const v1 = stored('races_5', { object: raceEarned(5, 5).object, factAt: day(5) });
    expect(reconcilePlan([v1], bronze, false, NOW)).toEqual([]);
    // тот же факт, но сохранённый ранг другой (устаревший параллельный план) — обновление
    const stale = { ...v1, level: 2 as const };
    expect(reconcilePlan([stale], bronze, false, NOW)).toEqual([
      { type: 'refresh', code: 'races_5', earned: raceEarned(5, 5, 1) },
    ]);
  });

  it('первая сверка — вставка просмотренной на любом уровне (серебро, A3)', () => {
    const silver = new Map<FactAchievementCode, Earned>([['races_5', raceEarned(15, 15, 2)]]);
    expect(reconcilePlan([], silver, true, NOW)).toEqual([
      { type: 'insert', code: 'races_5', earned: raceEarned(15, 15, 2), seenAt: NOW },
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
    expect([...all.keys()].sort()).toEqual([...FACT_ACHIEVEMENT_CODES].sort());
  });

  it('сезонные — в общем списке: в одном сезоне первым «Чемпион» (RC-S4)', () => {
    const items = [
      { code: 'season_regular' as const, factAt: day(10) },
      { code: 'season_champion' as const, factAt: day(10) },
      { code: 'race_win' as const, factAt: day(9) },
      { code: 'season_podium' as const, factAt: day(10) },
    ];
    expect(sortForList(items).map((item) => item.code)).toEqual([
      'season_champion',
      'season_podium',
      'season_regular',
      'race_win',
    ]);
  });
});

describe('FACT_ACHIEVEMENT_CODES (RC-S7)', () => {
  it('несезонные коды каталога; план несезонных сезонных кодов не содержит', () => {
    expect(FACT_ACHIEVEMENT_CODES).not.toContain('season_podium');
    expect(FACT_ACHIEVEMENT_CODES).toHaveLength(9);
    const plan = reconcilePlan([], new Map(), true, NOW);
    expect(plan).toEqual([]);
  });
});

const SEASON_A = id(101);
const SEASON_B = id(102);
const seasonRow = (place: number, placedRaces: number, tied = false): RiderSeasonRow => ({
  bikeClass: 'road',
  groupKey: 'm_u40',
  place,
  tied,
  placedRaces,
});
const ENDS_BEFORE = new Date('2025-10-31T21:00:00Z');
const finalOutcome = (seasonId: string, rows: RiderSeasonRow[]): RiderSeasonOutcome => ({
  seasonId,
  status: 'final',
  title: `Сезон ${seasonId.slice(-3)}`,
  endsOn: '2025-10-31',
  endsBefore: ENDS_BEFORE,
  rows,
});

describe('SEASONAL_RULES (S1, RC-S1, RC-S3, AC1)', () => {
  const earnedCodes = (rows: RiderSeasonRow[]) =>
    Object.entries(SEASONAL_RULES)
      .filter(([, rule]) => rule(rows))
      .map(([code]) => code);

  it('место 1 — чемпион и призёр; `=1` (ничья) — тоже; 3 — призёр; 4 — ничего', () => {
    expect(earnedCodes([seasonRow(1, 1)])).toEqual(['season_podium', 'season_champion']);
    expect(earnedCodes([seasonRow(1, 1, true)])).toEqual(['season_podium', 'season_champion']);
    expect(earnedCodes([seasonRow(3, 2)])).toEqual(['season_podium']);
    expect(earnedCodes([seasonRow(4, 2)])).toEqual([]);
  });

  it('2 гонки с местом — нет «Сезона в зачёте»; 3 — есть (в одной таблице)', () => {
    expect(earnedCodes([seasonRow(5, 2), seasonRow(6, 2)])).toEqual([]);
    expect(earnedCodes([seasonRow(5, 3)])).toEqual(['season_regular']);
  });

  it('строка только из DQ на месте 2 — не призёр (RC-S1: нужен финиш с местом)', () => {
    expect(earnedCodes([seasonRow(2, 0)])).toEqual([]);
    expect(earnedCodes([seasonRow(1, 0)])).toEqual([]);
  });

  it('любая таблица сезона: призёр в одной, в зачёте в другой', () => {
    expect(earnedCodes([seasonRow(2, 1), seasonRow(10, 4)])).toEqual([
      'season_regular',
      'season_podium',
    ]);
  });
});

describe('seasonalAchievements (S2, S3, RC-S6)', () => {
  it('`final` — заработанные по ключу `(code, seasonId)`; дата факта — последний день сезона по Минску', () => {
    const { earned, settled } = seasonalAchievements([
      finalOutcome(SEASON_A, [seasonRow(1, 3)]),
      finalOutcome(SEASON_B, [seasonRow(2, 1)]),
    ]);
    expect([...earned.keys()]).toEqual([
      seasonalKey({ code: 'season_regular', seasonId: SEASON_A }),
      seasonalKey({ code: 'season_podium', seasonId: SEASON_A }),
      seasonalKey({ code: 'season_champion', seasonId: SEASON_A }),
      seasonalKey({ code: 'season_podium', seasonId: SEASON_B }),
    ]);
    const champion = earned.get(seasonalKey({ code: 'season_champion', seasonId: SEASON_A }))!;
    expect(champion).toEqual({
      code: 'season_champion',
      seasonId: SEASON_A,
      factAt: new Date(ENDS_BEFORE.getTime() - 1),
      title: `Сезон ${SEASON_A.slice(-3)}`,
    });
    expect(minskToday(champion.factAt)).toBe('2025-10-31');
    expect([...settled]).toEqual([SEASON_A, SEASON_B]);
  });

  it('`pending` — нет заработанных, сезон не `settled`', () => {
    const { earned, settled } = seasonalAchievements([
      { seasonId: SEASON_A, status: 'pending', title: 'Сезон' },
    ]);
    expect(earned.size).toBe(0);
    expect(settled.size).toBe(0);
  });
});

describe('seasonalPlan (S2–S5, AC1)', () => {
  const earnedOf = (code: SeasonalEarned['code'], seasonId: string): SeasonalEarned => ({
    code,
    seasonId,
    factAt: new Date(ENDS_BEFORE.getTime() - 1),
    title: 'Сезон',
  });
  const mapOf = (...items: SeasonalEarned[]) =>
    new Map(items.map((item) => [seasonalKey(item), item]));
  const storedSeason = (
    code: SeasonalEarned['code'],
    seasonId: string,
    partial: Partial<StoredSeasonGrant> = {},
  ): StoredSeasonGrant => ({
    code,
    seasonId,
    factAt: new Date(ENDS_BEFORE.getTime() - 1),
    seenAt: day(1),
    revokedAt: null,
    ...partial,
  });
  const both = new Set([SEASON_A, SEASON_B]);

  it('два ключа одного кода разных сезонов — две вставки; первая сверка — просмотренными (A3/S5)', () => {
    const earned = mapOf(earnedOf('season_podium', SEASON_A), earnedOf('season_podium', SEASON_B));
    expect(seasonalPlan([], earned, both, false, NOW)).toEqual([
      { type: 'insert', earned: earnedOf('season_podium', SEASON_A), seenAt: null },
      { type: 'insert', earned: earnedOf('season_podium', SEASON_B), seenAt: null },
    ]);
    expect(
      seasonalPlan([], earned, both, true, NOW).map(
        (step) => step.type === 'insert' && step.seenAt,
      ),
    ).toEqual([NOW, NOW]);
  });

  it('сезон не `settled` (`pending`) — ни вставки, ни отзыва', () => {
    const earned = mapOf(earnedOf('season_podium', SEASON_A));
    expect(
      seasonalPlan([storedSeason('season_champion', SEASON_A)], earned, new Set(), false, NOW),
    ).toEqual([]);
  });

  it('`final` без строк — отзыв видимой; отозванная — ничего; вернулась — восстановление', () => {
    const settled = new Set([SEASON_A]);
    expect(
      seasonalPlan([storedSeason('season_podium', SEASON_A)], new Map(), settled, false, NOW),
    ).toEqual([{ type: 'revoke', key: { code: 'season_podium', seasonId: SEASON_A } }]);
    const revoked = storedSeason('season_podium', SEASON_A, { revokedAt: day(2) });
    expect(seasonalPlan([revoked], new Map(), settled, false, NOW)).toEqual([]);
    expect(
      seasonalPlan([revoked], mapOf(earnedOf('season_podium', SEASON_A)), settled, false, NOW),
    ).toEqual([{ type: 'restore', key: { code: 'season_podium', seasonId: SEASON_A } }]);
  });

  it('устойчивое состояние — пустой план; порядок — каталог, затем сезон', () => {
    const earned = mapOf(
      earnedOf('season_champion', SEASON_A),
      earnedOf('season_podium', SEASON_B),
      earnedOf('season_podium', SEASON_A),
    );
    expect(
      seasonalPlan(
        [
          storedSeason('season_podium', SEASON_A),
          storedSeason('season_champion', SEASON_A),
          storedSeason('season_podium', SEASON_B),
        ],
        earned,
        both,
        false,
        NOW,
      ),
    ).toEqual([]);
    expect(
      seasonalPlan([], earned, both, false, NOW).map(
        (step) => step.type === 'insert' && seasonalKey(step.earned),
      ),
    ).toEqual([
      seasonalKey({ code: 'season_podium', seasonId: SEASON_A }),
      seasonalKey({ code: 'season_podium', seasonId: SEASON_B }),
      seasonalKey({ code: 'season_champion', seasonId: SEASON_A }),
    ]);
  });
});
