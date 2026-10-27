import {
  type AttemptRejection,
  type EntryTier,
  type ErrorCode,
  type GroupScheme,
  minskToday,
  type MyRaceEntry,
  PUBLISH_CHECKS,
  PUBLISH_STATE_BLOCKS,
  type PublishCheck,
  type PublishChecklist,
  type PublishStateBlock,
  type RaceEntryBlockReason,
  type RacePhase,
  type RaceResultStatus,
  RESULT_GROUP_KEYS,
  type ResultGroupKey,
  type ResultUnrankedReason,
  type RiderGender,
} from '@pokatim/contracts';
import { type Bounds, boundsNear } from '@pokatim/tracks';

import type { RaceForResults } from '../races';
import type { ActivityRef } from '../tracks';
import type {
  AttemptFlagDoc,
  EntryBest,
  EntrySummary,
  RaceAttemptDoc,
  RaceEntryDoc,
  RaceProtocolRowDoc,
} from './results.collection';

/**
 * Правила участия и результатов (race-results-03) — чистые функции (unit). Значения — `[ASSUMPTION]`, кроме A5
 * (загрузка до закрытия окна + 24 ч).
 */
export const RESULTS_POLICY = {
  /** A5: загрузка до `closesAt` + 24 ч */
  uploadGraceMs: 24 * 3_600_000,
  /** auto + explicit; сверх — auto пропускается (лог), explicit — `ATTEMPT_LIMIT` */
  maxAttemptsPerEntry: 30,
  maxRequestsPerEntry: 30,
  /** заявка + отмена */
  entryUserLimit: { limit: 20, windowSec: 3600 },
  /** явные попытки (загрузки ограничены ещё и `tracks`) */
  attemptUserLimit: { limit: 30, windowSec: 3600 },
  /** кандидаты «своих заездов», скан заявки `entry-created` */
  candidatesLimit: 50,
  /** ≥ радиуса поиска движка (200 м) × 3: рамка трека ↔ рамка маршрута */
  boundsMarginM: 600,
  stuckCheckingMs: 15 * 60_000,
  stuckQueuedMs: 2 * 3_600_000,
  maxRequeues: 3,
  stuckBatchSize: 100,
  /** пакетов обхода зависших за проход (пропущенные с живой задачей не останавливают обход) */
  stuckScanBatches: 20,
  resultsPageDefault: 50,
  resultsPageMax: 100,
  /** race-results-05: строк «Участников» панели за ответ; больше — `truncated` */
  standingsMax: 1000,
  /** мутации протокола на сотрудника */
  panelUserLimit: { limit: 60, windowSec: 3600 },
  /** история пересчётов в панели */
  recalculationsMax: 100,
} as const;

/** Окно гонки для попыток: начало и исключающая граница `closesAt` (считает `races`). */
export type RaceWindow = Pick<RaceForResults, 'windowStartsAt' | 'closesAt'>;

/** A5: последний момент приёма файла для гонки (исключающая граница). */
export const uploadClosesAt = (race: Pick<RaceForResults, 'closesAt'>): Date =>
  new Date(race.closesAt.getTime() + RESULTS_POLICY.uploadGraceMs);

/**
 * Представитель группы дублей в гонке: первый по приоритету основной (`members` порта — в этом порядке) среди
 * принятых сервером до `uploadClosesAt` (A5). Поздний файл в гонку не идёт; своевременный не теряет попытку из-за
 * позднего дубля, ставшего основной в `tracks`. Своевременных нет — `null`.
 */
export function raceRepresentative(
  members: readonly ActivityRef[],
  race: Pick<RaceForResults, 'closesAt'>,
): ActivityRef | null {
  return members.find((member) => member.uploadCreatedAt < uploadClosesAt(race)) ?? null;
}

/**
 * Предфильтр автоматической попытки (§7.3) для представителя группы (`raceRepresentative`): не indoor, интервал
 * заезда пересекает `[windowStartsAt, closesAt)`, файл принят сервером до `uploadClosesAt`, рамки трека и маршрута
 * ближе маржи. Явный запрос райдера предфильтр не требует — судит движок.
 */
export function mayMatch(activity: ActivityRef, race: RaceWindow, routeBounds: Bounds): boolean {
  return (
    activity.sport !== 'cycling_indoor' &&
    activity.endedAt >= race.windowStartsAt &&
    activity.startedAt < race.closesAt &&
    activity.uploadCreatedAt < uploadClosesAt(race) &&
    boundsNear(activity.bounds, routeBounds, RESULTS_POLICY.boundsMarginM)
  );
}

/** Полный сегмент старт→финиш: скрытие автоматического несовпадения (A8). */
export function attemptMatched(match: {
  touchedCorridor: boolean;
  segment: unknown;
  reasons: readonly string[];
}): boolean {
  const first = match.reasons[0];
  return (
    match.touchedCorridor && match.segment !== null && first !== 'no_start' && first !== 'no_finish'
  );
}

/**
 * Скрыта от райдера (§7.4): снятые; автоматическая без полного сегмента (отказ или исключённая панелью —
 * race-results-05) или неправдоподобная. Явная — всегда видна. Панель видит всё с флагом.
 */
export function attemptHidden(
  attempt: Pick<RaceAttemptDoc, 'origin' | 'status' | 'matched' | 'reasons'>,
): boolean {
  if (attempt.status === 'withdrawn') return true;
  if (attempt.origin !== 'auto') return false;
  if (attempt.reasons[0] === 'implausible') return true;
  return (
    (attempt.status === 'rejected' || attempt.status === 'excluded') && attempt.matched === false
  );
}

/** Вердикт, о котором узнаёт райдер (уведомления, notifications RC-2). */
export type VisibleVerdict = 'counted' | 'rejected';

/**
 * Видимый вердикт итога проверки: `counted`/`rejected` и попытка не скрыта (`attemptHidden`) — о скрытой авто-попытке
 * (без полного сегмента, `implausible`) райдер не узнаёт; провал, снятие и исключение — `null`.
 */
export function visibleVerdict(
  origin: RaceAttemptDoc['origin'],
  result: Pick<RaceAttemptDoc, 'status' | 'matched' | 'reasons'>,
): VisibleVerdict | null {
  if (result.status !== 'counted' && result.status !== 'rejected') return null;
  return attemptHidden({ origin, ...result }) ? null : result.status;
}

type RankedAttempt = Pick<RaceAttemptDoc, '_id' | 'status' | 'segment' | 'sensors' | 'flags'>;

/**
 * Правило мест заявки (race-results-07): START — места нет (`none`); группа `overall` (схема `overall`, гонки до 07)
 * — любая засчитанная (`all`, как v1); группа пол × возраст — только попытка с пульсом (`heart_rate`). Verified в
 * `gender_age` никогда не `overall` (держит `allowedGroups`) — правило выводится из заявки без чтения гонки.
 */
export type RankRule = 'all' | 'heart_rate' | 'none';

export function rankRule(entry: Pick<RaceEntryDoc, 'tier' | 'groupKey'>): RankRule {
  if ((entry.tier ?? 'verified') === 'start') return 'none';
  return entry.groupKey === 'overall' ? 'all' : 'heart_rate';
}

/**
 * Лучшая засчитанная: минимальные `(elapsedSec, segment.startedAt, _id)`. `heart_rate` — лучшая с пульсом (RC-14:
 * хотя бы один отсчёт в сегменте), если такая есть (`ranked: true`), иначе лучшая вообще (`ranked: false`); `none` —
 * лучшая, `ranked: false`; `all` — лучшая, `ranked: true`. Флаги датчиков лучшей — в заявку (DV-9).
 */
export function pickBest(attempts: readonly RankedAttempt[], rule: RankRule): EntryBest | null {
  const counted = attempts.filter((attempt) => attempt.status === 'counted' && attempt.segment);
  const min = (xs: readonly RankedAttempt[]) =>
    xs.reduce<RankedAttempt | null>(
      (best, attempt) => (best === null || compareCounted(attempt, best) < 0 ? attempt : best),
      null,
    );
  let best = min(counted);
  let ranked = rule === 'all';
  if (rule === 'heart_rate') {
    const withHeartRate = min(counted.filter((attempt) => attempt.sensors?.hr === true));
    if (withHeartRate) {
      best = withHeartRate;
      ranked = true;
    }
  }
  if (!best?.segment) return null;
  return {
    attemptId: best._id,
    elapsedSec: best.segment.elapsedSec,
    startedAt: best.segment.startedAt,
    finishedAt: best.segment.finishedAt,
    ranked,
    flags: best.flags ?? [],
  };
}

function compareCounted(a: RankedAttempt, b: RankedAttempt): number {
  const sa = a.segment!;
  const sb = b.segment!;
  if (sa.elapsedSec !== sb.elapsedSec) return sa.elapsedSec - sb.elapsedSec;
  const ta = sa.startedAt.getTime();
  const tb = sb.startedAt.getTime();
  if (ta !== tb) return ta - tb;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

/** Сводка попыток заявки (хранится в заявке, `refreshEntry`). */
export function summarize(
  attempts: readonly Pick<RaceAttemptDoc, 'origin' | 'status' | 'matched' | 'reasons'>[],
): EntrySummary {
  const summary: EntrySummary = {
    total: 0,
    pending: 0,
    counted: 0,
    rejectedShown: 0,
    failed: 0,
    excluded: 0,
  };
  for (const attempt of attempts) {
    summary.total += 1;
    if (attempt.status === 'queued' || attempt.status === 'checking') summary.pending += 1;
    else if (attempt.status === 'counted') summary.counted += 1;
    else if (attempt.status === 'failed') summary.failed += 1;
    else if (attempt.status === 'excluded') summary.excluded += 1;
    else if (attempt.status === 'rejected' && !attemptHidden(attempt)) summary.rejectedShown += 1;
  }
  return summary;
}

/**
 * Статус результата участника (§7.4, по порядку) — считается при чтении: отменил → DQ по спору до публикации
 * (race-results-06, D-43) → лучший без места — `finisher` (race-results-07: START, Verified без пульса; и после
 * публикации — в снимке их нет) → есть лучший → идёт проверка → видимые отказы, провалы и исключённые → срок загрузки истёк
 * → ещё нет попыток. `ignoreBest` (RC-5): протокол опубликован, а строки участника в нём нет — живой лучший результат
 * места не даёт (и поле DQ не читается, RC-3).
 */
export function resultStatus(
  entry: Pick<RaceEntryDoc, 'status' | 'best' | 'summary' | 'disqualified'> | null,
  race: Pick<RaceForResults, 'closesAt' | 'protocolPublishedAt'>,
  now: Date,
  { ignoreBest = false }: { ignoreBest?: boolean } = {},
): RaceResultStatus {
  if (!entry) return 'none';
  if (entry.status === 'withdrawn') return 'withdrawn';
  if (!ignoreBest && disqualifiedBeforePublication(entry, race)) return 'dq';
  if (entry.best && entry.best.ranked === false) return 'finisher';
  if (entry.best && !ignoreBest) return 'provisional';
  if (entry.summary.pending > 0) return 'pending';
  const { rejectedShown, failed, excluded = 0 } = entry.summary;
  if (rejectedShown + failed + excluded > 0) return 'not_counted';
  if (now >= uploadClosesAt(race)) return 'dns';
  return 'none';
}

/**
 * DQ по спору до публикации (RC-3): поле заявки — проекция, читается только пока протокол не опубликован; после —
 * истина в журнале пересчётов и снимке. Документы до `0018_disputes` поля не имеют — `?? null`.
 */
export function disqualifiedBeforePublication(
  entry: Pick<RaceEntryDoc, 'disqualified'>,
  race: Pick<RaceForResults, 'protocolPublishedAt'>,
): boolean {
  return race.protocolPublishedAt === null && (entry.disqualified ?? null) !== null;
}

/**
 * Блок действий участника из-за спора (D-39, RC-6) — одна функция для «моего участия» и сервера: DQ до публикации →
 * `disqualified`; открытый спор против заявки → `dispute_open`; иначе `null`.
 */
export function entryDisputeBlock(
  entry: Pick<RaceEntryDoc, 'disqualified'>,
  openDisputes: number,
  race: Pick<RaceForResults, 'protocolPublishedAt'>,
): 'disqualified' | 'dispute_open' | null {
  if (disqualifiedBeforePublication(entry, race)) return 'disqualified';
  return openDisputes > 0 ? 'dispute_open' : null;
}

/**
 * Действия участия (D-37, C1/H2): заявиться, отменить, добавить попытку — и причины недоступности (без повторов).
 * `phase` — фаза гонки (`racePhase` из `races`). Споры (race-results-06, RC-4): причина спора добавляется, только
 * когда действие по прежним правилам было бы доступно (закрытое окно объясняется своей причиной).
 */
export function entryActions(
  race: Pick<
    RaceForResults,
    'status' | 'corridor' | 'closesAt' | 'protocolPublishedAt' | 'groupScheme'
  >,
  phase: RacePhase,
  entry:
    | (Pick<RaceEntryDoc, 'status' | 'summary' | 'disqualified'> & { tier?: EntryTier | null })
    | null,
  now: Date,
  { openDisputes }: { openDisputes: number },
): MyRaceEntry['actions'] {
  const reasons: RaceEntryBlockReason[] = [];
  const block = (reason: RaceEntryBlockReason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
    return false;
  };
  const enterable = phase === 'upcoming' || phase === 'open';

  if (!entry) {
    let canEnter = true;
    if (race.status === 'cancelled') canEnter = block('cancelled');
    else if (race.corridor === null) canEnter = block('no_corridor');
    else if (!enterable) canEnter = block('entries_closed');
    block('not_entered');
    return { canEnter, canWithdraw: false, canAddAttempt: false, reasons, canUpgrade: false };
  }
  if (entry.status === 'withdrawn') {
    block('withdrawn');
    return {
      canEnter: false,
      canWithdraw: false,
      canAddAttempt: false,
      reasons,
      canUpgrade: false,
    };
  }

  let canWithdraw = true;
  if (race.status === 'cancelled') canWithdraw = block('cancelled');
  else if (!enterable) canWithdraw = block('window_closed');

  let canAddAttempt = true;
  if (race.status === 'cancelled') canAddAttempt = block('cancelled');
  else if (phase === 'upcoming') canAddAttempt = block('window_not_open');
  else if (now >= uploadClosesAt(race)) canAddAttempt = block('upload_closed');
  else if (entry.summary.total >= RESULTS_POLICY.maxAttemptsPerEntry) {
    canAddAttempt = block('attempt_limit');
  }

  const dispute = entryDisputeBlock(entry, openDisputes, race);
  if (dispute && canWithdraw) canWithdraw = block(dispute);
  if (dispute && canAddAttempt) canAddAttempt = block(dispute);
  // race-results-07: START → Verified, пока окно открыто (анкету и группу проверяет заявка)
  const canUpgrade =
    race.status !== 'cancelled' &&
    enterable &&
    race.groupScheme === 'gender_age' &&
    entry.tier === 'start';
  return { canEnter: false, canWithdraw, canAddAttempt, reasons, canUpgrade };
}

/** Почему явную попытку принять нельзя (`ATTEMPT_UPLOAD_CLOSED.details.reason`); `null` — можно. */
export function attemptClosedReason(
  race: Pick<RaceForResults, 'status' | 'closesAt'>,
  phase: RacePhase,
  now: Date,
): RaceEntryBlockReason | null {
  if (race.status === 'cancelled') return 'cancelled';
  if (phase === 'upcoming' || phase === 'draft') return 'window_not_open';
  if (now >= uploadClosesAt(race)) return 'upload_closed';
  return null;
}

/** Место строки и ничья (A7): строки по `(elapsedSec, startedAt, _id)`, равенство — по целым секундам. */
export interface RankContext {
  /** строк группы с `elapsedSec` меньше, чем у первой строки страницы */
  lessThanFirst: number;
  /** строк группы до первой строки страницы в порядке сортировки */
  firstIndex: number;
  /** полное число строк с тем же `elapsedSec` для значений первой и последней строки страницы */
  equalCounts: ReadonlyMap<number, number>;
}

/**
 * Места строк страницы «1, =2, =2, 4»: место = 1 + строк с меньшим временем; ничья — таких же ≥ 2. Группы времени
 * внутри страницы считаются по самой странице; группы на её краях — по `equalCounts` (ничья на границе страниц
 * сохраняет «=N»).
 */
export function rankRows(
  rows: readonly { elapsedSec: number }[],
  context: RankContext,
): { place: number; tied: boolean }[] {
  const inPage = new Map<number, number>();
  for (const row of rows) inPage.set(row.elapsedSec, (inPage.get(row.elapsedSec) ?? 0) + 1);
  const ranked: { place: number; tied: boolean }[] = [];
  rows.forEach((row, index) => {
    const previous = index > 0 ? rows[index - 1] : undefined;
    const place =
      index === 0
        ? context.lessThanFirst + 1
        : previous && previous.elapsedSec === row.elapsedSec
          ? ranked[index - 1]!.place
          : context.firstIndex + index + 1;
    const total = context.equalCounts.get(row.elapsedSec) ?? inPage.get(row.elapsedSec) ?? 1;
    ranked.push({ place, tied: total >= 2 });
  });
  return ranked;
}

/** Вердикт движка → поля попытки (§7.5). */
export function verdictFields(match: {
  verdict: 'counted' | 'rejected';
  reasons: readonly AttemptRejection[];
  touchedCorridor: boolean;
  segment: RaceAttemptDoc['segment'];
}): Pick<RaceAttemptDoc, 'status' | 'reasons' | 'matched'> {
  return {
    status: match.verdict === 'counted' ? 'counted' : 'rejected',
    reasons: match.verdict === 'counted' ? [] : [...match.reasons],
    matched: attemptMatched(match),
  };
}

// --- протокол (race-results-05) ---

/** Исключить трек можно из любого статуса, кроме снятого и уже исключённого (D-24). */
export const EXCLUDABLE_STATUSES = ['queued', 'checking', 'counted', 'rejected', 'failed'] as const;

/**
 * Чек-лист публикации (D-22, D-23) — одна функция для чтения панели и транзакции публикации: все строки
 * `PUBLISH_CHECKS` в их порядке; `blockedBy` — первое подходящее состояние гонки (`PUBLISH_STATE_BLOCKS`).
 * `pendingChecks` — незавершённые проверки (`queued + checking +` устаревшие вердикты, RC-1). «Требует внимания» не
 * блокирует (D-22).
 */
export function publishChecklist(input: {
  race: Pick<RaceForResults, 'status' | 'corridor' | 'protocolPublishedAt'>;
  now: Date;
  uploadClosesAt: Date;
  openDisputes: number;
  unprocessedTracks: number;
  pendingChecks: number;
  failedChecks: number;
}): PublishChecklist {
  const { race } = input;
  const states: Record<PublishStateBlock, boolean> = {
    draft: race.status === 'draft',
    cancelled: race.status === 'cancelled',
    no_corridor: race.corridor === null,
    published: race.protocolPublishedAt !== null,
  };
  const counts: Record<PublishCheck, number> = {
    open_disputes: input.openDisputes,
    unprocessed_tracks: input.unprocessedTracks,
    checks_queued: input.pendingChecks,
    checks_failed: input.failedChecks,
    // A5: файлы принимаются до конца окна + 24 ч
    window_open: input.now < input.uploadClosesAt ? 1 : 0,
  };
  const blockedBy = PUBLISH_STATE_BLOCKS.find((state) => states[state]) ?? null;
  const checklist = PUBLISH_CHECKS.map((code) => ({ code, count: counts[code] }));
  return {
    canPublish: blockedBy === null && checklist.every((row) => row.count === 0),
    blockedBy,
    checklist,
  };
}

/** Участник протокола до расчёта мест: лучший результат, группа, флаги датчиков и признак DQ. */
export interface ProtocolBase {
  entryId: string;
  userId: string;
  attemptId: string;
  elapsedSec: number;
  startedAt: Date;
  dq: boolean;
  groupKey: ResultGroupKey;
  /** флаги датчиков (без `SPEED_CLUSTER_HIGH` — его считает ревизия) */
  flags: AttemptFlagDoc[];
}

type PreviousRow = Pick<RaceProtocolRowDoc, 'place' | 'tied' | 'elapsedSec' | 'status'>;

const byProtocolOrder = (a: ProtocolBase, b: ProtocolBase): number => {
  if (a.elapsedSec !== b.elapsedSec) return a.elapsedSec - b.elapsedSec;
  const ta = a.startedAt.getTime();
  const tb = b.startedAt.getTime();
  if (ta !== tb) return ta - tb;
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
};

/** Флаги строки: скорость (если есть), затем датчики — в порядке `ATTEMPT_FLAG_CODES`. */
export function rowFlags(
  sensors: readonly AttemptFlagDoc[],
  speed: AttemptFlagDoc | undefined,
): AttemptFlagDoc[] {
  const sensorOnly = sensors.filter((flag) => flag.code !== 'SPEED_CLUSTER_HIGH');
  return speed ? [speed, ...sensorOnly] : sensorOnly;
}

/**
 * Ревизия протокола целиком (D-27, D-28; race-results-07 — по группам): группы по порядку `RESULT_GROUP_KEYS`; внутри
 * — не-DQ по `(elapsedSec, startedAt, entryId)` с местами `rankRows`, затем DQ группы без места; `order` сквозной
 * (RC-9). Флаги строки — датчики из базы + `SPEED_CLUSTER_HIGH` по не-DQ строкам ревизии. Статус строки: DQ — `dq`;
 * публикация (`previous: null`) — `final`; место, ничья и время как в прошлой ревизии (и там не DQ) — статус прошлой;
 * иначе — `revised` («Пересчитан»).
 */
export function buildProtocol(
  base: readonly ProtocolBase[],
  previous: ReadonlyMap<string, PreviousRow> | null,
): Omit<RaceProtocolRowDoc, '_id' | 'raceId' | 'revision' | 'createdAt'>[] {
  const speed = speedClusterFlags(base.filter((row) => !row.dq));
  const statusOf = (row: ProtocolBase, place: number | null, tied: boolean) => {
    if (row.dq) return 'dq' as const;
    if (previous === null) return 'final' as const;
    const prev = previous.get(row.entryId);
    const same =
      prev !== undefined &&
      prev.status !== 'dq' &&
      prev.place === place &&
      prev.tied === tied &&
      prev.elapsedSec === row.elapsedSec;
    return same ? prev.status : ('revised' as const);
  };
  const ordered: { row: ProtocolBase; place: number | null; tied: boolean }[] = [];
  for (const group of RESULT_GROUP_KEYS) {
    const members = base.filter((row) => row.groupKey === group);
    const ranked = members.filter((row) => !row.dq).sort(byProtocolOrder);
    const disqualified = members.filter((row) => row.dq).sort(byProtocolOrder);
    const equalCounts = new Map<number, number>();
    for (const row of ranked) {
      equalCounts.set(row.elapsedSec, (equalCounts.get(row.elapsedSec) ?? 0) + 1);
    }
    const places = rankRows(ranked, { lessThanFirst: 0, firstIndex: 0, equalCounts });
    ordered.push(
      ...ranked.map((row, index) => ({ row, ...places[index]! })),
      ...disqualified.map((row) => ({ row, place: null, tied: false })),
    );
  }
  return ordered.map(({ row, place, tied }, order) => ({
    order,
    entryId: row.entryId,
    userId: row.userId,
    attemptId: row.attemptId,
    elapsedSec: row.elapsedSec,
    startedAt: row.startedAt,
    place,
    tied,
    status: statusOf(row, place, tied),
    groupKey: row.groupKey,
    flags: rowFlags(row.flags, row.dq ? undefined : speed.get(row.entryId)),
  }));
}

/**
 * Перепроверка после публикации ждёт «Применить»: последний запуск не раньше публикации и новее последнего
 * применения (R3).
 */
export function recheckPending(
  last: { startedAt: Date | null; appliedAt: Date | null },
  protocolPublishedAt: Date | null,
): boolean {
  if (last.startedAt === null || protocolPublishedAt === null) return false;
  if (last.startedAt < protocolPublishedAt) return false;
  return last.appliedAt === null || last.startedAt > last.appliedAt;
}

// --- уровни и группы зачёта (race-results-07) ---

/** Год гонки — год конца окна по Минску (возраст — на 31 декабря этого года). */
export const raceYear = (race: Pick<RaceForResults, 'windowEndsAt'>): number =>
  Number(minskToday(race.windowEndsAt).slice(0, 4));

const GENDER_GROUPS: Record<RiderGender, readonly ResultGroupKey[]> = {
  m: ['m_u40', 'm_40_49', 'm_50p'],
  w: ['w_u40', 'w_40_49', 'w_50p'],
};

/** Своя группа по анкете: возраст на 31.12 года гонки; `≤ 39` → `u40`, `40–49` → `40_49`, `≥ 50` → `50p`. */
export function ownGroup(
  gender: RiderGender,
  birthYear: number,
  race: Pick<RaceForResults, 'windowEndsAt'>,
): ResultGroupKey {
  const age = raceYear(race) - birthYear;
  const band = age <= 39 ? 0 : age <= 49 ? 1 : 2;
  return GENDER_GROUPS[gender][band]!;
}

/** Разрешённые группы: своя первой, затем младшие того же пола. */
export function allowedGroups(own: ResultGroupKey): ResultGroupKey[] {
  for (const groups of Object.values(GENDER_GROUPS)) {
    const index = groups.indexOf(own);
    if (index >= 0) return groups.slice(0, index + 1).reverse();
  }
  return [own];
}

/** Намерение клиента по заявке. */
export interface EntryIntent {
  tier?: EntryTier;
  groupKey?: ResultGroupKey;
}

type ExistingEntry = Pick<RaceEntryDoc, 'status' | 'tier' | 'groupKey'>;

/** Итог матрицы заявки: создать, повысить START → Verified, ничего не менять — или отказ. */
export type EntryPlan =
  | { kind: 'create' | 'upgrade'; tier: EntryTier; groupKey: ResultGroupKey }
  | { kind: 'noop' }
  | {
      kind: 'error';
      code: Extract<
        ErrorCode,
        'VERIFIED_PROFILE_REQUIRED' | 'RACE_TIER_LOCKED' | 'RESULT_GROUP_NOT_ALLOWED'
      >;
    };

const planError = (code: Extract<EntryPlan, { kind: 'error' }>['code']): EntryPlan => ({
  kind: 'error',
  code,
});

/**
 * Нужна ли анкета (и её фиксация в транзакции): создание или повышение Verified в схеме `gender_age`. Вызывающий
 * передаёт `planEntryChange` анкету только тогда (иначе `null`).
 */
export function needsVerifiedProfile(input: {
  scheme: GroupScheme;
  existing: ExistingEntry | null;
  request: EntryIntent;
}): boolean {
  const { scheme, existing, request } = input;
  if (scheme !== 'gender_age' || request.tier !== 'verified') return false;
  return existing === null || (existing.tier ?? 'verified') === 'start';
}

/**
 * Вся матрица заявки (race-results-07) — одна чистая функция:
 * - `overall` (RC-1): уровень не выбирается — `verified`/`overall`; `groupKey` ≠ `overall` — 422; существующая — noop;
 * - `gender_age`, новая: нет `tier` или `start` → `start`/`overall` (группа ≠ `overall` — 422); `verified` — анкета
 *   (нет — 409), группа своя или младшая своего пола (иначе 422);
 * - `gender_age`, существующая активная: нет `tier` — noop (RC-2); Verified: `start` или другая группа — 409 (RC-3),
 *   та же или без группы — noop; START: `start` — noop, `verified` — только в `upcoming|open` (иначе 409), анкета и
 *   группа — как у новой → `upgrade`.
 */
export function planEntryChange(input: {
  scheme: GroupScheme;
  phase: RacePhase;
  existing: ExistingEntry | null;
  request: EntryIntent;
  profile: { gender: RiderGender; birthYear: number } | null;
  race: Pick<RaceForResults, 'windowEndsAt'>;
}): EntryPlan {
  const { scheme, phase, existing, request, profile, race } = input;
  const groupOf = (): EntryPlan => {
    if (!profile) return planError('VERIFIED_PROFILE_REQUIRED');
    const own = ownGroup(profile.gender, profile.birthYear, race);
    const groupKey = request.groupKey ?? own;
    if (!allowedGroups(own).includes(groupKey)) return planError('RESULT_GROUP_NOT_ALLOWED');
    return { kind: existing ? 'upgrade' : 'create', tier: 'verified', groupKey };
  };
  const startGroupOk = request.groupKey === undefined || request.groupKey === 'overall';

  if (scheme === 'overall') {
    if (!startGroupOk) return planError('RESULT_GROUP_NOT_ALLOWED');
    return existing ? { kind: 'noop' } : { kind: 'create', tier: 'verified', groupKey: 'overall' };
  }
  if (!existing) {
    if (request.tier === 'verified') return groupOf();
    if (!startGroupOk) return planError('RESULT_GROUP_NOT_ALLOWED');
    return { kind: 'create', tier: 'start', groupKey: 'overall' };
  }
  if (request.tier === undefined) return { kind: 'noop' };
  const tier = existing.tier ?? 'verified';
  if (tier === 'verified') {
    if (request.tier === 'start') return planError('RACE_TIER_LOCKED');
    const sameGroup = request.groupKey === undefined || request.groupKey === existing.groupKey;
    return sameGroup ? { kind: 'noop' } : planError('RACE_TIER_LOCKED');
  }
  if (request.tier === 'start') {
    return startGroupOk ? { kind: 'noop' } : planError('RESULT_GROUP_NOT_ALLOWED');
  }
  if (phase !== 'upcoming' && phase !== 'open') return planError('RACE_TIER_LOCKED');
  return groupOf();
}

/** Почему время без места («моё участие», финишёры, панель): `null` — место есть или результата нет. */
export function unrankedOf(
  entry: Pick<RaceEntryDoc, 'best' | 'tier'>,
): ResultUnrankedReason | null {
  if (!entry.best || entry.best.ranked !== false) return null;
  return (entry.tier ?? 'verified') === 'start' ? 'start' : 'no_heart_rate';
}

/** Пороги `SPEED_CLUSTER_HIGH` (спайк §3.3 (а)/(б)). */
export const SPEED_CLUSTER_POLICY = { minRows: 5, medianShare: 0.8 } as const;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Флаг кластера скорости по **ранжированным** строкам гонки без DQ (все группы, RC-12): (а) в группе ≥ 5 строк и
 * `elapsedSec / медиана группы < 0,80`; (б) в гонке ≥ 5 строк — строки с абсолютно лучшим временем не из `m_u40` и не
 * `overall`. Метрика — отношение к медиане своей группы (до 0,001); оба правила — один флаг.
 */
export function speedClusterFlags(
  rows: readonly { entryId: string; groupKey: ResultGroupKey; elapsedSec: number }[],
): Map<string, AttemptFlagDoc> {
  // времена группы — одним проходом, медиана — один раз на группу
  const byGroup = new Map<ResultGroupKey, number[]>();
  for (const row of rows) {
    const values = byGroup.get(row.groupKey);
    if (values) values.push(row.elapsedSec);
    else byGroup.set(row.groupKey, [row.elapsedSec]);
  }
  const medians = new Map([...byGroup].map(([group, values]) => [group, median(values)]));
  const fastest = rows.reduce((min, row) => Math.min(min, row.elapsedSec), Infinity);
  const flags = new Map<string, AttemptFlagDoc>();
  for (const row of rows) {
    const groupMedian = medians.get(row.groupKey)!;
    const ratio = row.elapsedSec / groupMedian;
    const clusterA =
      byGroup.get(row.groupKey)!.length >= SPEED_CLUSTER_POLICY.minRows &&
      ratio < SPEED_CLUSTER_POLICY.medianShare;
    const clusterB =
      rows.length >= SPEED_CLUSTER_POLICY.minRows &&
      row.elapsedSec === fastest &&
      row.groupKey !== 'm_u40' &&
      row.groupKey !== 'overall';
    if (clusterA || clusterB) {
      flags.set(row.entryId, {
        code: 'SPEED_CLUSTER_HIGH',
        metric: Math.round(ratio * 1000) / 1000,
      });
    }
  }
  return flags;
}
