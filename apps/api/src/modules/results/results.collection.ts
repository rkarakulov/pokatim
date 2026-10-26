import type {
  AttemptFailure,
  AttemptOrigin,
  AttemptRejection,
  AttemptStatus,
  AttemptWithdrawReason,
  RaceEntryStatus,
  ResultGroupKey,
  TrackSource,
} from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `results` (race-results-03, ADR-0012 п. 3–4, 6): заявки и попытки. Создаёт миграция
 * `0015_results`; единственный писатель — `ResultsRepository`. Время — BSON `Date` (UTC) из `CLOCK`, nullable — явным
 * `null`. Лучший результат и сводка попыток — поля заявки (до снимка протокола слайса 05).
 */
export const RESULTS_COLLECTIONS = { entries: 'race_entries', attempts: 'race_attempts' } as const;

/** Явное намерение райдера по загрузке или активности («загрузить в гонку», «выбрать свой заезд»). */
export interface EntryRequest {
  uploadId: string;
  /** активность загрузки, когда она готова */
  activityId: string | null;
  requestedAt: Date;
  /** попытка основной активности группы; `null` — файл ещё разбирается или не принят */
  attemptId: string | null;
}

export interface EntryBest {
  attemptId: string;
  elapsedSec: number;
  startedAt: Date;
  finishedAt: Date;
}

export interface EntrySummary {
  /** все попытки заявки (включая снятые) — предел `maxAttemptsPerEntry` */
  total: number;
  /** `queued` | `checking` */
  pending: number;
  counted: number;
  /** отказы, видимые райдеру */
  rejectedShown: number;
  failed: number;
}

/**
 * Заявка — одна на (гонку, райдера), `active | withdrawn` (повторной заявки нет). Документ — **замок участника**:
 * транзакция, меняющая попытки заявки, её запросы, лучший результат или статус, первой операцией пишет `version`
 * (`lockEntry`).
 */
export interface RaceEntryDoc {
  _id: string;
  raceId: string;
  userId: string;
  status: RaceEntryStatus;
  /** A3: одна группа зачёта v1; кластеры и уровень — слайс 07 */
  groupKey: ResultGroupKey;
  tier: null;
  requests: EntryRequest[];
  best: EntryBest | null;
  summary: EntrySummary;
  createdAt: Date;
  updatedAt: Date;
  withdrawnAt: Date | null;
  version: number;
}

/** Сегмент между воротами как в движке (целые метры, `Date`) — без координат и датчиков. */
export interface AttemptSegmentDoc {
  startedAt: Date;
  finishedAt: Date;
  elapsedMs: number;
  elapsedSec: number;
  distanceM: number;
  offCorridorM: number;
  offCorridorShare: number;
  maxExcursionM: number;
  coverage: number;
  noisePoints: number;
}

/**
 * Попытка — (гонка, основная активность) уникальна. `checkRevision` — номер проверки: вердикт пишет только своя
 * ревизия. `activity` — снимок сводки активности (неизменяема после разбора) для «моего участия».
 */
export interface RaceAttemptDoc {
  _id: string;
  raceId: string;
  entryId: string;
  userId: string;
  activityId: string;
  uploadId: string;
  activity: { startedAt: Date; source: TrackSource; elapsedSec: number; distanceM: number };
  origin: AttemptOrigin;
  status: AttemptStatus;
  /** полный сегмент старт→финиш (видимость автоматической попытки); до вердикта — `null` */
  matched: boolean | null;
  reasons: AttemptRejection[];
  failure: AttemptFailure | null;
  withdrawReason: AttemptWithdrawReason | null;
  segment: AttemptSegmentDoc | null;
  touchedCorridor: boolean | null;
  candidates: number | null;
  diagnostics: {
    corridorLengthM: number;
    declaredDistanceM: number;
    geometryLimited: boolean;
  } | null;
  engineVersion: number | null;
  /** снимок коридора гонки на момент создания (V-12 — не меняется) */
  corridor: { routeId: string; widthM: number };
  checkRevision: number;
  checkAttempts: number;
  requeues: number;
  /** id события outbox последней постановки на проверку (= jobId задачи `attempt-check`); до постановки — `null` */
  checkJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
  checkedAt: Date | null;
}

export interface ResultsCollections {
  entries: Collection<RaceEntryDoc>;
  attempts: Collection<RaceAttemptDoc>;
}

export function resultsCollections(db: Db): ResultsCollections {
  return {
    entries: db.collection<RaceEntryDoc>(RESULTS_COLLECTIONS.entries),
    attempts: db.collection<RaceAttemptDoc>(RESULTS_COLLECTIONS.attempts),
  };
}
