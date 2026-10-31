import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_LEVEL_TARGETS,
  ACHIEVEMENT_LEVELS,
  type AchievementCode,
  type AchievementLevel,
  type AchievementObjectKind,
  isLeveledCode,
  isSeasonalCode,
  type LeveledAchievementCode,
  type RiderAchievementAdminStatus,
  SEASON_REGULAR_MIN_RACES,
  SEASONAL_ACHIEVEMENT_CODES,
  type SeasonalAchievementCode,
} from '@pokatim/contracts';

import { isRankedRow, type RiderProtocolRow } from '../results';
import type { RiderRideFact } from '../rides';
import type { RiderRouteRideFact } from '../route-rides';
import type { RiderSeasonOutcome, RiderSeasonRow } from '../standings';

/** Несезонные коды — по фактам райдера (RC-S7); сезонные сверяет `seasonalPlan` по `(code, seasonId)`. */
export type FactAchievementCode = Exclude<AchievementCode, SeasonalAchievementCode>;
export const FACT_ACHIEVEMENT_CODES = ACHIEVEMENT_CODES.filter(
  (code): code is FactAchievementCode => !isSeasonalCode(code),
);

/** Лимиты частоты (RC-12): сверка на чтении и отметка «показано». */
export const ACHIEVEMENTS_POLICY = {
  readLimit: { limit: 60, windowSec: 60 },
  seenLimit: { limit: 120, windowSec: 3600 },
} as const;

/**
 * Серверная сверка (achievements-push N2, 5.D): регламент `achievements.sweep` по курсорам источников. `pageRows` —
 * предел строк источника за прогон (остаток — следующим); `settleMs` — строки не новее `now − settleMs` (запас на коммит
 * транзакции); `rideSettleMs` — райд «прошёл» для push через 3 ч после старта (RC-P1 (b)); `lostCursorMs` — нет
 * курсора (первый запуск или потеря Redis) — окно с `until − lostCursorMs` (RC-P9); `recipientsBatch` — пачка фильтров
 * `liveUserIds`/`syncedAmong`; задача райдера — `riderAttempts` попыток, экспоненциальная пауза от `riderBackoffMs`;
 * `lockTtlMs` — замок одного прогона за раз.
 */
export const ACHIEVEMENTS_SERVER_SYNC = {
  pageRows: 500,
  settleMs: 2 * 60_000,
  rideSettleMs: 3 * 3_600_000,
  lostCursorMs: 10 * 60_000,
  recipientsBatch: 500,
  riderAttempts: 3,
  riderBackoffMs: 5_000,
  riderConcurrency: 4,
  lockTtlMs: 5 * 60_000,
} as const;

/** Факты райдера из портов владельцев (`results`, `route-rides`, `rides`). */
export interface AchievementFacts {
  races: readonly RiderProtocolRow[];
  routes: readonly RiderRouteRideFact[];
  rides: readonly RiderRideFact[];
}

export interface AchievementObjectRef {
  kind: Exclude<AchievementObjectKind, 'season'>;
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
  earned: Map<FactAchievementCode, Earned>;
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

/** Каталог правил (A1): исчерпывающий по несезонным — новый код без правила — ошибка типов. */
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
} satisfies Record<FactAchievementCode, (facts: Sorted) => Earned | null>;

/** Прогресс к следующему уровню (L4): счёт 0 и золото — без строки; порядок каталога. */
function progressOf(sorted: Sorted): ProgressItem[] {
  const progress: ProgressItem[] = [];
  for (const code of FACT_ACHIEVEMENT_CODES) {
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
  const earned = new Map<FactAchievementCode, Earned>();
  for (const code of FACT_ACHIEVEMENT_CODES) {
    const result = ACHIEVEMENT_RULES[code](sorted);
    if (result) earned.set(code, result);
  }
  return { earned, progress: progressOf(sorted) };
}

/** Заработанные достижения райдера (порядок ключей — порядок каталога). Чистая функция. */
export function earnedAchievements(facts: AchievementFacts): Map<FactAchievementCode, Earned> {
  return evaluateAchievements(facts).earned;
}

/** Публичный список (A7): те же правила, только гоночные. */
export function raceAchievements(
  rows: readonly RiderProtocolRow[],
): Map<FactAchievementCode, Earned> {
  const earned = earnedAchievements({ races: rows, routes: [], rides: [] });
  for (const [code, item] of earned) if (item.object.kind !== 'race') earned.delete(code);
  return earned;
}

/**
 * Ручное решение команды (achievements-panel, 5.A): поле `override` документа выдачи обеих коллекций. `null` или нет
 * поля — выдача подчиняется сверке; иначе сверка документ не трогает (план пропускает, фильтры записи — `override:
 * null`), пока решение не снимут.
 */
export interface AchievementOverride {
  decision: 'granted' | 'revoked';
  at: Date;
  byUserId: string;
}

/**
 * Видимая ручная выдача (achievements-panel): решение `granted`, не отозвана. Одна для списка, публичного списка и
 * карточки (`AchievementsSharing`).
 */
export const manuallyGranted = (grant: {
  revokedAt: Date | null;
  override?: AchievementOverride | null;
}) => grant.revokedAt === null && grant.override?.decision === 'granted';

/** Сохранённая выдача (поля сверки); `level`/`seenLevel` нет у документов v1 — ≡ 1. */
export interface StoredGrant {
  code: FactAchievementCode;
  object: AchievementObjectRef;
  factAt: Date;
  seenAt: Date | null;
  revokedAt: Date | null;
  level?: LevelRank | null;
  seenLevel?: LevelRank | null;
  /** наибольший объявленный ранг (achievements-push); нет у документов до выката — ≡ `storedRank` */
  notifiedLevel?: LevelRank | null;
  /** ручное решение (achievements-panel); нет у документов до выката — ≡ `null` */
  override?: AchievementOverride | null;
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

/**
 * Нужно ли уведомление при `refresh`/`restore` несезонной выдачи (P1, P3, 5.A): новый ранг `level` выше объявленного
 * (`notifiedLevel`, нет — сохранённый ранг: документы до выката ретро-уведомлений не дают) и не показан. Понижение, та
 * же ступень с другим объектом, возврат на показанный или уже объявленный уровень — тихо. По документу **до** записи.
 * Вставка не в первой сверке уведомляет всегда (это решает сверка, не эта функция). Чистая функция.
 */
export function noticeDue(
  before: Pick<StoredGrant, 'seenAt' | 'seenLevel' | 'level' | 'notifiedLevel'>,
  level: LevelRank | null,
): boolean {
  const rank = level ?? 1;
  return !isSeen(before, rank) && (before.notifiedLevel ?? storedRank(before)) < rank;
}

export type ReconcileStep =
  | { type: 'insert'; code: FactAchievementCode; earned: Earned; seenAt: Date | null }
  | { type: 'restore'; code: FactAchievementCode; earned: Earned }
  | { type: 'refresh'; code: FactAchievementCode; earned: Earned }
  | { type: 'revoke'; code: FactAchievementCode };

const sameFact = (grant: StoredGrant, earned: Earned) =>
  grant.object.kind === earned.object.kind &&
  grant.object.id === earned.object.id &&
  grant.factAt.getTime() === earned.factAt.getTime();

/**
 * План сверки (7.2, A2–A4, L3): новое — вставка (первая сверка — сразу просмотренной на любом уровне, A3); отозванное,
 * вернувшееся — восстановление (`seenAt`/`seenLevel` прежние); видимое с другим объектом, датой или уровнем —
 * обновление; пропавшее — отзыв; код с ручным решением (`override`) — пропуск целиком. Устойчивое состояние — пустой
 * план. Чистая функция.
 */
export function reconcilePlan(
  stored: readonly StoredGrant[],
  earned: ReadonlyMap<FactAchievementCode, Earned>,
  first: boolean,
  now: Date,
): ReconcileStep[] {
  const byCode = new Map(stored.map((grant) => [grant.code, grant]));
  const plan: ReconcileStep[] = [];
  for (const code of FACT_ACHIEVEMENT_CODES) {
    const grant = byCode.get(code);
    // ручное решение — сверка код не трогает (achievements-panel, 5.B; второй рубеж — фильтр записи)
    if (grant?.override) continue;
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

/** Правила сезонных (S1): по строкам райдера одного `final`-сезона; «Чемпион» и «Призёр» — с финишем (RC-S1). */
export const SEASONAL_RULES = {
  season_regular: (rows) => rows.some((row) => row.placedRaces >= SEASON_REGULAR_MIN_RACES),
  season_podium: (rows) => rows.some((row) => row.placedRaces >= 1 && row.place <= PODIUM_MAX),
  season_champion: (rows) => rows.some((row) => row.placedRaces >= 1 && row.place === 1),
} satisfies Record<SeasonalAchievementCode, (rows: readonly RiderSeasonRow[]) => boolean>;

/** Ключ сезонной выдачи (S3): код + сезон. */
export interface SeasonalKey {
  code: SeasonalAchievementCode;
  seasonId: string;
}
export const seasonalKey = (key: SeasonalKey) => `${key.code}:${key.seasonId}`;

/** Заработанное сезонное: дата факта — последний миг сезона (`endsBefore − 1 мс`, RC-S6), название — сезона. */
export interface SeasonalEarned extends SeasonalKey {
  factAt: Date;
  title: string;
}

/**
 * Сезонные (S1–S3): заработанные по `final`-сезонам (порядок — сезоны порта, внутри — каталог); `settled` — сезоны, где
 * сверка вправе менять выдачи (`final`). Чистая функция.
 */
export function seasonalAchievements(outcomes: readonly RiderSeasonOutcome[]): {
  earned: Map<string, SeasonalEarned>;
  settled: ReadonlySet<string>;
} {
  const earned = new Map<string, SeasonalEarned>();
  const settled = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.status !== 'final') continue;
    settled.add(outcome.seasonId);
    const factAt = new Date(outcome.endsBefore.getTime() - 1);
    for (const code of SEASONAL_ACHIEVEMENT_CODES) {
      if (!SEASONAL_RULES[code](outcome.rows)) continue;
      const item = { code, seasonId: outcome.seasonId, factAt, title: outcome.title };
      earned.set(seasonalKey(item), item);
    }
  }
  return { earned, settled };
}

/** Сохранённая сезонная выдача (поля сверки). */
export interface StoredSeasonGrant extends SeasonalKey {
  factAt: Date;
  seenAt: Date | null;
  revokedAt: Date | null;
  /** ручное решение (achievements-panel); нет — ≡ `null` */
  override?: AchievementOverride | null;
}

export type SeasonalStep =
  | { type: 'insert'; earned: SeasonalEarned; seenAt: Date | null }
  | { type: 'restore'; key: SeasonalKey }
  | { type: 'revoke'; key: SeasonalKey };

const keyOrder = (a: SeasonalKey, b: SeasonalKey) =>
  SEASONAL_ACHIEVEMENT_CODES.indexOf(a.code) - SEASONAL_ACHIEVEMENT_CODES.indexOf(b.code) ||
  (a.seasonId < b.seasonId ? -1 : a.seasonId > b.seasonId ? 1 : 0);

/**
 * План сезонной сверки (S2–S5): только ключи `settled`-сезонов — новое — вставка (первая сверка — просмотренной, A3),
 * вернувшееся — восстановление (`seenAt` прежний, S4), пропавшее — отзыв видимой; сезоны в `pending` — ни вставки, ни
 * отзыва; ключ с ручным решением — пропуск. `refresh` нет: объект — сам сезон, дата завершённого сезона не меняется.
 * Порядок — каталог, затем сезон.
 * Чистая функция.
 */
export function seasonalPlan(
  stored: readonly StoredSeasonGrant[],
  earned: ReadonlyMap<string, SeasonalEarned>,
  settled: ReadonlySet<string>,
  first: boolean,
  now: Date,
): SeasonalStep[] {
  const byKey = new Map(stored.map((grant) => [seasonalKey(grant), grant]));
  const keys = new Map<string, SeasonalKey>();
  for (const item of [...stored, ...earned.values()]) {
    if (byKey.get(seasonalKey(item))?.override) continue;
    if (settled.has(item.seasonId))
      keys.set(seasonalKey(item), { code: item.code, seasonId: item.seasonId });
  }
  const plan: SeasonalStep[] = [];
  for (const [id, key] of [...keys].sort(([, a], [, b]) => keyOrder(a, b))) {
    const grant = byKey.get(id);
    const fact = earned.get(id);
    if (fact && !grant) plan.push({ type: 'insert', earned: fact, seenAt: first ? now : null });
    else if (fact && grant?.revokedAt) plan.push({ type: 'restore', key });
    else if (!fact && grant && grant.revokedAt === null) plan.push({ type: 'revoke', key });
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

/** Статус выдачи в панели (achievements-panel, 5.G): видимая = не отозвана (RC-12), ручная — по `override`. */
export function adminStatus(doc: {
  revokedAt: Date | null;
  override?: AchievementOverride | null;
}): RiderAchievementAdminStatus {
  if (doc.revokedAt === null)
    return doc.override?.decision === 'granted' ? 'granted_manually' : 'granted';
  return doc.override?.decision === 'revoked' ? 'revoked_manually' : 'revoked';
}

/**
 * Прогресс без противоречия ручному уровню (RC-9): строка счётного кода, у которого видимая ручная выдача ранга ≥ уровня
 * строки, выкидывается («Серебро 7/15» при ручном золоте). Остальные — по фактам. Чистая функция.
 */
export function progressBeyondManual(
  progress: readonly ProgressItem[],
  grants: readonly Pick<StoredGrant, 'code' | 'revokedAt' | 'level' | 'override'>[],
): ProgressItem[] {
  const manual = new Map(
    grants
      .filter((grant) => grant.revokedAt === null && grant.override?.decision === 'granted')
      .map((grant) => [grant.code, storedRank(grant)]),
  );
  return progress.filter((step) => (manual.get(step.code) ?? 0) < step.level);
}
