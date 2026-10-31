import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_LEVEL_TARGETS,
  ACHIEVEMENT_LEVELS,
  type AchievementCode,
  type AchievementLevel,
  type AchievementObjectKind,
  isLeveledCode,
  type LeveledAchievementCode,
} from '@pokatim/contracts';

import { isRankedRow, type RiderProtocolRow } from '../results';
import type { RiderRideFact } from '../rides';
import type { RiderRouteRideFact } from '../route-rides';

/** Лимиты частоты (RC-12): сверка на чтении и отметка «показано». */
export const ACHIEVEMENTS_POLICY = {
  readLimit: { limit: 60, windowSec: 60 },
  seenLimit: { limit: 120, windowSec: 3600 },
} as const;

/** Факты райдера из портов владельцев (`results`, `route-rides`, `rides`). */
export interface AchievementFacts {
  races: readonly RiderProtocolRow[];
  routes: readonly RiderRouteRideFact[];
  rides: readonly RiderRideFact[];
}

export interface AchievementObjectRef {
  kind: AchievementObjectKind;
  id: string;
}

/** Ранг уровня счётного (хранится числом — для `$lt`/`$max`); наружу — `levelName`. */
export type LevelRank = 1 | 2 | 3;

/**
 * Заработанное достижение: объект, время факта, название (гонки — `null`, название даёт `racesOf`) и уровень
 * (счётные — ранг, разовые — `null`).
 */
export interface Earned {
  object: AchievementObjectRef;
  factAt: Date;
  title: string | null;
  level: LevelRank | null;
}

/** Прогресс к следующему уровню счётного (L4). */
export interface ProgressItem {
  code: LeveledAchievementCode;
  level: LevelRank;
  current: number;
  target: number;
}

/** Результат правил над фактами: заработанные (порядок каталога) и прогресс (порядок каталога). */
export interface Evaluation {
  earned: Map<AchievementCode, Earned>;
  progress: ProgressItem[];
}

/** Ранг → строка контракта (ответы, порт карточки). */
export const levelName = (rank: LevelRank): AchievementLevel => ACHIEVEMENT_LEVELS[rank - 1]!;

const RANKS = [1, 2, 3] as const satisfies readonly LevelRank[];
const PODIUM_MAX = 3;
/** Организатор + хотя бы один «Иду» (RC-15: организатор входит в `goingCount`). */
const ORGANIZER_MIN_GOING = 2;

/** Порядок фактов: время ↑, при равенстве — id ↑ (объект не «прыгает» между сверками). */
const chronological = <T>(items: readonly T[], at: (item: T) => Date, id: (item: T) => string) =>
  [...items].sort(
    (a, b) => at(a).getTime() - at(b).getTime() || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0),
  );

const raceEarned = (
  row: RiderProtocolRow | undefined,
  level: LevelRank | null = null,
): Earned | null =>
  row
    ? { object: { kind: 'race', id: row.raceId }, factAt: row.startedAt, title: null, level }
    : null;
const routeEarned = (
  fact: RiderRouteRideFact | undefined,
  level: LevelRank | null = null,
): Earned | null =>
  fact
    ? {
        object: { kind: 'route', id: fact.routeId },
        factAt: fact.startedAt,
        title: fact.routeTitle,
        level,
      }
    : null;
const rideEarned = (
  fact: RiderRideFact | undefined,
  level: LevelRank | null = null,
): Earned | null =>
  fact
    ? {
        object: { kind: 'ride', id: fact.rideId },
        factAt: fact.startsAt,
        title: fact.title,
        level,
      }
    : null;

/** Факты, упорядоченные один раз на сверку. */
interface Sorted {
  /** строки «в зачёте» (RC-9) — одна строка = одна гонка */
  races: (RiderProtocolRow & { place: number })[];
  /** первый заезд каждого маршрута, маршруты — по дате первого заезда */
  routes: RiderRouteRideFact[];
  rides: RiderRideFact[];
}

function sortFacts(facts: AchievementFacts): Sorted {
  const firstPerRoute = new Map<string, RiderRouteRideFact>();
  for (const fact of chronological(
    facts.routes,
    (f) => f.startedAt,
    (f) => f.routeId,
  )) {
    if (!firstPerRoute.has(fact.routeId)) firstPerRoute.set(fact.routeId, fact);
  }
  return {
    races: chronological(
      facts.races.filter(isRankedRow),
      (row) => row.startedAt,
      (row) => row.raceId,
    ),
    routes: [...firstPerRoute.values()],
    rides: chronological(
      facts.rides,
      (f) => f.startsAt,
      (f) => f.rideId,
    ),
  };
}

/** Источник счёта счётного кода — одна таблица для правила и прогресса (второго счёта нет). */
const LEVELED_FACTS = {
  races_5: (s) => s.races,
  routes_5: (s) => s.routes,
  rides_10: (s) => s.rides,
} satisfies Record<LeveledAchievementCode, (s: Sorted) => readonly unknown[]>;

/** Наибольший достигнутый ранг при счёте `count`; ниже бронзы — `null`. */
function reachedRank(code: LeveledAchievementCode, count: number): LevelRank | null {
  const targets = ACHIEVEMENT_LEVEL_TARGETS[code];
  let reached: LevelRank | null = null;
  for (const rank of RANKS) if (count >= targets[rank - 1]!) reached = rank;
  return reached;
}

/** Правило счётного (L1, L2): наибольший ранг; объект и дата — факт порога этого ранга. */
function leveled<T>(
  code: LeveledAchievementCode,
  list: (s: Sorted) => readonly T[],
  toEarned: (item: T | undefined, level: LevelRank) => Earned | null,
) {
  return (s: Sorted): Earned | null => {
    const items = list(s);
    const rank = reachedRank(code, items.length);
    return rank === null
      ? null
      : toEarned(items[ACHIEVEMENT_LEVEL_TARGETS[code][rank - 1]! - 1], rank);
  };
}

/** Каталог правил (A1): исчерпывающий — новый код без правила — ошибка типов. */
export const ACHIEVEMENT_RULES = {
  race_first_finish: (f) => raceEarned(f.races[0]),
  race_podium: (f) => raceEarned(f.races.find((row) => row.place <= PODIUM_MAX)),
  race_win: (f) => raceEarned(f.races.find((row) => row.place === 1)),
  races_5: leveled('races_5', LEVELED_FACTS.races_5, raceEarned),
  route_first: (f) => routeEarned(f.routes[0]),
  routes_5: leveled('routes_5', LEVELED_FACTS.routes_5, routeEarned),
  ride_first: (f) => rideEarned(f.rides[0]),
  ride_organizer: (f) =>
    rideEarned(f.rides.find((ride) => ride.organizer && ride.goingCount >= ORGANIZER_MIN_GOING)),
  rides_10: leveled('rides_10', LEVELED_FACTS.rides_10, rideEarned),
} satisfies Record<AchievementCode, (facts: Sorted) => Earned | null>;

/** Прогресс к следующему уровню (L4): счёт 0 и золото — без строки; порядок каталога. */
function progressOf(sorted: Sorted): ProgressItem[] {
  const progress: ProgressItem[] = [];
  for (const code of ACHIEVEMENT_CODES) {
    if (!isLeveledCode(code)) continue;
    const current = LEVELED_FACTS[code](sorted).length;
    const targets = ACHIEVEMENT_LEVEL_TARGETS[code];
    const next = RANKS.find((rank) => targets[rank - 1]! > current);
    if (current > 0 && next !== undefined)
      progress.push({ code, level: next, current, target: targets[next - 1]! });
  }
  return progress;
}

/** Заработанные достижения и прогресс — над одной сортировкой фактов. Чистая функция. */
export function evaluateAchievements(facts: AchievementFacts): Evaluation {
  const sorted = sortFacts(facts);
  const earned = new Map<AchievementCode, Earned>();
  for (const code of ACHIEVEMENT_CODES) {
    const result = ACHIEVEMENT_RULES[code](sorted);
    if (result) earned.set(code, result);
  }
  return { earned, progress: progressOf(sorted) };
}

/** Заработанные достижения райдера (порядок ключей — порядок каталога). Чистая функция. */
export function earnedAchievements(facts: AchievementFacts): Map<AchievementCode, Earned> {
  return evaluateAchievements(facts).earned;
}

/** Публичный список (A7): те же правила, только гоночные. */
export function raceAchievements(rows: readonly RiderProtocolRow[]): Map<AchievementCode, Earned> {
  const earned = earnedAchievements({ races: rows, routes: [], rides: [] });
  for (const [code, item] of earned) if (item.object.kind !== 'race') earned.delete(code);
  return earned;
}

/** Сохранённая выдача (поля сверки); `level`/`seenLevel` нет у документов v1 — ≡ 1. */
export interface StoredGrant {
  code: AchievementCode;
  object: AchievementObjectRef;
  factAt: Date;
  seenAt: Date | null;
  revokedAt: Date | null;
  level?: LevelRank | null;
  seenLevel?: LevelRank | null;
}

/** Сохранённый ранг (документ v1 и разовые — 1). */
export const storedRank = (grant: Pick<StoredGrant, 'level'>): LevelRank => grant.level ?? 1;

/** «Показано» (L3): показан хотя бы уровень `level` (ответа, а не сохранённый, RC-L10); `null` ≡ 1. */
export function isSeen(
  grant: Pick<StoredGrant, 'seenAt' | 'seenLevel'>,
  level: LevelRank | null,
): boolean {
  return grant.seenAt !== null && (grant.seenLevel ?? 1) >= (level ?? 1);
}

export type ReconcileStep =
  | { type: 'insert'; code: AchievementCode; earned: Earned; seenAt: Date | null }
  | { type: 'restore'; code: AchievementCode; earned: Earned }
  | { type: 'refresh'; code: AchievementCode; earned: Earned }
  | { type: 'revoke'; code: AchievementCode };

const sameFact = (grant: StoredGrant, earned: Earned) =>
  grant.object.kind === earned.object.kind &&
  grant.object.id === earned.object.id &&
  grant.factAt.getTime() === earned.factAt.getTime();

/**
 * План сверки (7.2, A2–A4, L3): новое — вставка (первая сверка — сразу просмотренной на любом уровне, A3); отозванное,
 * вернувшееся — восстановление (`seenAt`/`seenLevel` прежние); видимое с другим объектом, датой или уровнем —
 * обновление; пропавшее — отзыв. Устойчивое состояние — пустой план. Чистая функция.
 */
export function reconcilePlan(
  stored: readonly StoredGrant[],
  earned: ReadonlyMap<AchievementCode, Earned>,
  first: boolean,
  now: Date,
): ReconcileStep[] {
  const byCode = new Map(stored.map((grant) => [grant.code, grant]));
  const plan: ReconcileStep[] = [];
  for (const code of ACHIEVEMENT_CODES) {
    const grant = byCode.get(code);
    const fact = earned.get(code);
    if (fact && !grant)
      plan.push({ type: 'insert', code, earned: fact, seenAt: first ? now : null });
    else if (fact && grant?.revokedAt) plan.push({ type: 'restore', code, earned: fact });
    else if (fact && grant && (!sameFact(grant, fact) || storedRank(grant) !== (fact.level ?? 1)))
      plan.push({ type: 'refresh', code, earned: fact });
    else if (!fact && grant && grant.revokedAt === null) plan.push({ type: 'revoke', code });
  }
  return plan;
}

const catalogIndex = (code: AchievementCode) => ACHIEVEMENT_CODES.indexOf(code);

/** Порядок списка (A8): от новых фактов к старым, при равенстве — порядок каталога ↓. */
export function sortForList<T extends { code: AchievementCode; factAt: Date }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      b.factAt.getTime() - a.factAt.getTime() || catalogIndex(b.code) - catalogIndex(a.code),
  );
}
