import {
  ACHIEVEMENT_CODES,
  type AchievementCode,
  type AchievementObjectKind,
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

/** Заработанное достижение: объект, время факта и название (гонки — `null`, название даёт `racesOf`). */
export interface Earned {
  object: AchievementObjectRef;
  factAt: Date;
  title: string | null;
}

const PODIUM_MAX = 3;
const RACES_GOAL = 5;
const ROUTES_GOAL = 5;
const RIDES_GOAL = 10;
/** Организатор + хотя бы один «Иду» (RC-15: организатор входит в `goingCount`). */
const ORGANIZER_MIN_GOING = 2;

/** Порядок фактов: время ↑, при равенстве — id ↑ (объект не «прыгает» между сверками). */
const chronological = <T>(items: readonly T[], at: (item: T) => Date, id: (item: T) => string) =>
  [...items].sort(
    (a, b) => at(a).getTime() - at(b).getTime() || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0),
  );

const raceEarned = (row: RiderProtocolRow | undefined): Earned | null =>
  row ? { object: { kind: 'race', id: row.raceId }, factAt: row.startedAt, title: null } : null;
const routeEarned = (fact: RiderRouteRideFact | undefined): Earned | null =>
  fact
    ? {
        object: { kind: 'route', id: fact.routeId },
        factAt: fact.startedAt,
        title: fact.routeTitle,
      }
    : null;
const rideEarned = (fact: RiderRideFact | undefined): Earned | null =>
  fact
    ? { object: { kind: 'ride', id: fact.rideId }, factAt: fact.startsAt, title: fact.title }
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

/** Каталог правил v1 (A1): исчерпывающий — новый код без правила — ошибка типов. */
export const ACHIEVEMENT_RULES = {
  race_first_finish: (f) => raceEarned(f.races[0]),
  race_podium: (f) => raceEarned(f.races.find((row) => row.place <= PODIUM_MAX)),
  race_win: (f) => raceEarned(f.races.find((row) => row.place === 1)),
  races_5: (f) => raceEarned(f.races[RACES_GOAL - 1]),
  route_first: (f) => routeEarned(f.routes[0]),
  routes_5: (f) => routeEarned(f.routes[ROUTES_GOAL - 1]),
  ride_first: (f) => rideEarned(f.rides[0]),
  ride_organizer: (f) =>
    rideEarned(f.rides.find((ride) => ride.organizer && ride.goingCount >= ORGANIZER_MIN_GOING)),
  rides_10: (f) => rideEarned(f.rides[RIDES_GOAL - 1]),
} satisfies Record<AchievementCode, (facts: Sorted) => Earned | null>;

/** Заработанные достижения райдера (порядок ключей — порядок каталога). Чистая функция. */
export function earnedAchievements(facts: AchievementFacts): Map<AchievementCode, Earned> {
  const sorted = sortFacts(facts);
  const earned = new Map<AchievementCode, Earned>();
  for (const code of ACHIEVEMENT_CODES) {
    const result = ACHIEVEMENT_RULES[code](sorted);
    if (result) earned.set(code, result);
  }
  return earned;
}

/** Публичный список (A7): те же правила, только гоночные. */
export function raceAchievements(rows: readonly RiderProtocolRow[]): Map<AchievementCode, Earned> {
  const earned = earnedAchievements({ races: rows, routes: [], rides: [] });
  for (const [code, item] of earned) if (item.object.kind !== 'race') earned.delete(code);
  return earned;
}

/** Сохранённая выдача (поля сверки). */
export interface StoredGrant {
  code: AchievementCode;
  object: AchievementObjectRef;
  factAt: Date;
  seenAt: Date | null;
  revokedAt: Date | null;
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
 * План сверки (7.2, A2–A4): новое — вставка (первая сверка — сразу просмотренной, A3); отозванное, вернувшееся —
 * восстановление (`seenAt` прежний); видимое с другим объектом или датой — обновление; пропавшее — отзыв. Устойчивое
 * состояние — пустой план. Чистая функция.
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
    else if (fact && grant && !sameFact(grant, fact))
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
