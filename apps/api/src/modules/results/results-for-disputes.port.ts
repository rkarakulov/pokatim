import type {
  EntryTier,
  PanelAttemptFlag,
  RaceEntryStatus,
  RaceResultStatus,
  ResultGroupKey,
} from '@pokatim/contracts';

import type { DbSession } from '../../db';
import type { RaceForResults } from '../races';

/**
 * Порт `results` для модуля `disputes` (race-results-06, эпик §3.7; через `modules/results/index.ts`): заявки гонки для
 * права подачи, замок заявки в транзакции спора, DQ до публикации (D-43), место цели. `disputes` коллекции
 * `race_entries` не читает.
 */
export const RESULTS_FOR_DISPUTES = Symbol('RESULTS_FOR_DISPUTES');

/** Заявка для спора. `disqualified` — DQ по спору до публикации (поле заявки читается только до публикации). */
export interface DisputeEntry {
  id: string;
  raceId: string;
  userId: string;
  groupKey: ResultGroupKey;
  status: RaceEntryStatus;
  best: { elapsedSec: number; startedAt: Date } | null;
  disqualified: boolean;
  /** race-results-07: уровень заявки (до 07 — `verified`) */
  tier: EntryTier;
  /** лучший результат даёт место (Verified с местом в группе); без лучшего — `false` */
  ranked: boolean;
}

/** Статус и место результата участника — как в «моём участии». */
export interface DisputeStanding {
  resultStatus: RaceResultStatus;
  place: number | null;
  tied: boolean;
  elapsedSec: number | null;
  /** race-results-07: уровень и группа цели, её живые флаги «Требует внимания» (датчики + скорость) */
  tier: EntryTier;
  groupKey: ResultGroupKey;
  flags: PanelAttemptFlag[];
}

/**
 * Сегмент лучшей засчитанной попытки заявки — что строить на разборе спора (race-results-06b): активность-исходник и
 * моменты ворот; `checkRevision` — ключ кэша рядов (перепроверка даёт новую ревизию).
 */
export interface SeriesSegment {
  attemptId: string;
  activityId: string;
  checkRevision: number;
  startedAt: Date;
  finishedAt: Date;
}

export interface ResultsForDisputes {
  /** Заявка пользователя на гонку (без замка, RC-12). */
  entryOf(raceId: string, userId: string, session?: DbSession): Promise<DisputeEntry | null>;
  entry(entryId: string, session?: DbSession): Promise<DisputeEntry | null>;
  /** Замок заявки (`ResultsRepository.lockEntry`) — конфликт с отменой участия, явной попыткой и приёмом. */
  lockEntry(tx: DbSession, entryId: string, now: Date): Promise<DisputeEntry | null>;
  /**
   * D-43 до публикации: `disqualified ← { at, disputeId }` и запись `race_recalculations { kind: 'disqualified',
   * revision: null, reason: 'dispute:<disputeId>' }`. Заявка не активна или уже DQ — `false`, без записей.
   */
  disqualify(
    tx: DbSession,
    input: { raceId: string; entryId: string; disputeId: string; actorUserId: string; at: Date },
  ): Promise<boolean>;
  /** Статус и место как в «моём участии» (`ResultsReadService.entryResult`), snapshot-сессия. */
  standing(race: RaceForResults, entryId: string): Promise<DisputeStanding | null>;
  /** Сегмент лучшей попытки заявки (`counted`, с сегментом); нет лучшей — `null`. */
  bestSegment(entryId: string): Promise<SeriesSegment | null>;
}
