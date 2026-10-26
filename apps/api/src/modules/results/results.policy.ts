import {
  type AttemptRejection,
  type MyRaceEntry,
  PUBLISH_CHECKS,
  PUBLISH_STATE_BLOCKS,
  type PublishCheck,
  type PublishChecklist,
  type PublishStateBlock,
  type RaceEntryBlockReason,
  type RacePhase,
  type RaceResultStatus,
} from '@pokatim/contracts';
import { type Bounds, boundsNear } from '@pokatim/tracks';

import type { RaceForResults } from '../races';
import type { ActivityRef } from '../tracks';
import type {
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
  /** A3: одна группа зачёта v1 */
  groupKey: 'overall',
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

type RankedAttempt = Pick<RaceAttemptDoc, '_id' | 'status' | 'segment'>;

/** Лучшая засчитанная: минимальные `(elapsedSec, segment.startedAt, _id)`. */
export function pickBest(attempts: readonly RankedAttempt[]): EntryBest | null {
  let best: RankedAttempt | null = null;
  for (const attempt of attempts) {
    if (attempt.status !== 'counted' || !attempt.segment) continue;
    if (best === null || compareCounted(attempt, best) < 0) best = attempt;
  }
  if (!best?.segment) return null;
  return {
    attemptId: best._id,
    elapsedSec: best.segment.elapsedSec,
    startedAt: best.segment.startedAt,
    finishedAt: best.segment.finishedAt,
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
 * Статус результата участника (§7.4, по порядку) — считается при чтении: отменил → есть лучший → идёт проверка →
 * видимые отказы, провалы и исключённые → срок загрузки истёк → ещё нет попыток. `ignoreBest` (RC-5): протокол
 * опубликован, а строки участника в нём нет — живой лучший результат места не даёт.
 */
export function resultStatus(
  entry: Pick<RaceEntryDoc, 'status' | 'best' | 'summary'> | null,
  race: Pick<RaceForResults, 'closesAt'>,
  now: Date,
  { ignoreBest = false }: { ignoreBest?: boolean } = {},
): RaceResultStatus {
  if (!entry) return 'none';
  if (entry.status === 'withdrawn') return 'withdrawn';
  if (entry.best && !ignoreBest) return 'provisional';
  if (entry.summary.pending > 0) return 'pending';
  const { rejectedShown, failed, excluded = 0 } = entry.summary;
  if (rejectedShown + failed + excluded > 0) return 'not_counted';
  if (now >= uploadClosesAt(race)) return 'dns';
  return 'none';
}

/**
 * Действия участия (D-37, C1/H2): заявиться, отменить, добавить попытку — и причины недоступности (без повторов).
 * `phase` — фаза гонки (`racePhase` из `races`).
 */
export function entryActions(
  race: Pick<RaceForResults, 'status' | 'corridor' | 'closesAt'>,
  phase: RacePhase,
  entry: Pick<RaceEntryDoc, 'status' | 'summary'> | null,
  now: Date,
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
    return { canEnter, canWithdraw: false, canAddAttempt: false, reasons };
  }
  if (entry.status === 'withdrawn') {
    block('withdrawn');
    return { canEnter: false, canWithdraw: false, canAddAttempt: false, reasons };
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
  return { canEnter: false, canWithdraw, canAddAttempt, reasons };
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

/** Участник протокола до расчёта мест: лучший результат и признак DQ. */
export interface ProtocolBase {
  entryId: string;
  userId: string;
  attemptId: string;
  elapsedSec: number;
  startedAt: Date;
  dq: boolean;
}

type PreviousRow = Pick<RaceProtocolRowDoc, 'place' | 'tied' | 'elapsedSec' | 'status'>;

const byProtocolOrder = (a: ProtocolBase, b: ProtocolBase): number => {
  if (a.elapsedSec !== b.elapsedSec) return a.elapsedSec - b.elapsedSec;
  const ta = a.startedAt.getTime();
  const tb = b.startedAt.getTime();
  if (ta !== tb) return ta - tb;
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
};

/**
 * Ревизия протокола целиком (D-27, D-28): не-DQ по `(elapsedSec, startedAt, entryId)` с местами `rankRows`, DQ — в
 * конце в том же порядке без места. Статус строки: DQ — `dq`; публикация (`previous: null`) — `final`; место, ничья и
 * время как в прошлой ревизии (и там не DQ) — статус прошлой; иначе — `revised` («Пересчитан»).
 */
export function buildProtocol(
  base: readonly ProtocolBase[],
  previous: ReadonlyMap<string, PreviousRow> | null,
): Omit<RaceProtocolRowDoc, '_id' | 'raceId' | 'revision' | 'createdAt'>[] {
  const ranked = base.filter((row) => !row.dq).sort(byProtocolOrder);
  const disqualified = base.filter((row) => row.dq).sort(byProtocolOrder);
  const equalCounts = new Map<number, number>();
  for (const row of ranked)
    equalCounts.set(row.elapsedSec, (equalCounts.get(row.elapsedSec) ?? 0) + 1);
  const places = rankRows(ranked, { lessThanFirst: 0, firstIndex: 0, equalCounts });
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
  return [
    ...ranked.map((row, index) => ({ row, ...places[index]! })),
    ...disqualified.map((row) => ({ row, place: null, tied: false })),
  ].map(({ row, place, tied }, order) => ({
    order,
    entryId: row.entryId,
    userId: row.userId,
    attemptId: row.attemptId,
    elapsedSec: row.elapsedSec,
    startedAt: row.startedAt,
    place,
    tied,
    status: statusOf(row, place, tied),
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
