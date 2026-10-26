import type {
  AttemptRejection,
  MyRaceEntry,
  RaceEntryBlockReason,
  RacePhase,
  RaceResultStatus,
} from '@pokatim/contracts';
import { type Bounds, boundsNear } from '@pokatim/tracks';

import type { RaceForResults } from '../races';
import type { ActivityRef } from '../tracks';
import type { EntryBest, EntrySummary, RaceAttemptDoc, RaceEntryDoc } from './results.collection';

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
  resultsPageDefault: 50,
  resultsPageMax: 100,
  /** A3: одна группа зачёта v1 */
  groupKey: 'overall',
} as const;

/** Окно гонки для попыток: начало и исключающая граница `closesAt` (считает `races`). */
export type RaceWindow = Pick<RaceForResults, 'windowStartsAt' | 'closesAt'>;

/** A5: последний момент приёма файла для гонки (исключающая граница). */
export const uploadClosesAt = (race: Pick<RaceForResults, 'closesAt'>): Date =>
  new Date(race.closesAt.getTime() + RESULTS_POLICY.uploadGraceMs);

/**
 * Предфильтр автоматической попытки (§7.3): основная активность, не indoor, интервал заезда пересекает
 * `[windowStartsAt, closesAt)`, файл принят сервером до `uploadClosesAt`, рамки трека и маршрута ближе маржи.
 * Явный запрос райдера предфильтр не требует — судит движок.
 */
export function mayMatch(activity: ActivityRef, race: RaceWindow, routeBounds: Bounds): boolean {
  return (
    activity.isPrimary &&
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
 * Скрыта от райдера (§7.4): снятые; автоматическая без полного сегмента или неправдоподобная. Явная — всегда видна.
 * Панель видит всё с флагом.
 */
export function attemptHidden(
  attempt: Pick<RaceAttemptDoc, 'origin' | 'status' | 'matched' | 'reasons'>,
): boolean {
  if (attempt.status === 'withdrawn') return true;
  if (attempt.origin !== 'auto') return false;
  if (attempt.reasons[0] === 'implausible') return true;
  return attempt.status === 'rejected' && attempt.matched === false;
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
  const summary: EntrySummary = { total: 0, pending: 0, counted: 0, rejectedShown: 0, failed: 0 };
  for (const attempt of attempts) {
    summary.total += 1;
    if (attempt.status === 'queued' || attempt.status === 'checking') summary.pending += 1;
    else if (attempt.status === 'counted') summary.counted += 1;
    else if (attempt.status === 'failed') summary.failed += 1;
    else if (attempt.status === 'rejected' && !attemptHidden(attempt)) summary.rejectedShown += 1;
  }
  return summary;
}

/**
 * Статус результата участника (§7.4, по порядку) — считается при чтении: отменил → есть лучший → идёт проверка →
 * видимые отказы и провалы → срок загрузки истёк → ещё нет попыток.
 */
export function resultStatus(
  entry: Pick<RaceEntryDoc, 'status' | 'best' | 'summary'> | null,
  race: Pick<RaceForResults, 'closesAt'>,
  now: Date,
): RaceResultStatus {
  if (!entry) return 'none';
  if (entry.status === 'withdrawn') return 'withdrawn';
  if (entry.best) return 'provisional';
  if (entry.summary.pending > 0) return 'pending';
  if (entry.summary.rejectedShown + entry.summary.failed > 0) return 'not_counted';
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
