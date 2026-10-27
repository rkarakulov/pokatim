import type {
  AttemptFailure,
  AttemptOrigin,
  AttemptRejection,
  AttemptReviewKind,
  AttemptStatus,
  AttemptWithdrawReason,
  ProtocolRowStatus,
  RaceEntryStatus,
  RecalculationKind,
  ResultGroupKey,
  TrackSource,
} from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `results` (race-results-03, ADR-0012 п. 3–4, 6): заявки и попытки (`0015_results`); протокол
 * (race-results-05, `0016_protocol`): исключения треков, снимок протокола по ревизиям, журнал пересчётов — только
 * вставки. Единственный писатель — `ResultsRepository`. Время — BSON `Date` (UTC) из `CLOCK`, nullable — явным
 * `null`. Лучший результат и сводка попыток — поля заявки; после публикации протокол — только из снимка.
 */
export const RESULTS_COLLECTIONS = {
  entries: 'race_entries',
  attempts: 'race_attempts',
  reviews: 'race_attempt_reviews',
  protocolRows: 'race_protocol_rows',
  recalculations: 'race_recalculations',
} as const;

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
  /** исключены панелью (race-results-05); заявки до слайса 05 поля не имеют — чтение `?? 0` */
  excluded: number;
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
  /**
   * DQ по спору до публикации протокола (race-results-06, D-43): проекция решения «Удовлетворить», пишет
   * `ResultsRepository.disqualifyEntry`. Читается **только пока `protocolPublishedAt === null`** (RC-3): после
   * публикации «действующие DQ» — журнал `race_recalculations` и снимок, поле не читается и не меняется. Документы до
   * `0018_disputes` поля не имеют — чтение `?? null`.
   */
  disqualified: { at: Date; disputeId: string } | null;
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
/**
 * Разметка трека попытки на линии показа своей активности (`activity_tracks.line`, maps-02): позиции — дробные
 * индексы вершин `i + t`, кратны 0,001; без координат и времени точек. Пишет worker при сверке вместе с вердиктом.
 */
export interface AttemptTrackMapDoc {
  /** число точек линии, по которой посчитаны позиции (чтение сверяет с сохранённой линией) */
  linePoints: number;
  segment: [number, number] | null;
  /** выходы из коридора внутри `segment`, по возрастанию, ≤ 100 */
  offRuns: [number, number][];
}

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
  /**
   * разметка трека для карты участника (maps-02); `null` — до вердикта, провал, `implausible`, нет сегмента или линии;
   * документы до maps-02 поля не имеют — чтение `?? null` (бэкфилла нет)
   */
  trackMap?: AttemptTrackMapDoc | null;
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

/** Исключение трека панелью или возврат в обработку (D-24) — только вставка. Причина райдеру не уходит. */
export interface RaceAttemptReviewDoc {
  _id: string;
  raceId: string;
  entryId: string;
  attemptId: string;
  kind: AttemptReviewKind;
  reason: string;
  actorUserId: string;
  at: Date;
}

/**
 * Строка снимка протокола (D-22, D-27): участник в ревизии `revision` (1 — публикация, далее — пересчёты; каждая
 * ревизия — целиком новая, старые не меняются). `order` — позиция в протоколе (DQ — в конце), `place: null` у DQ.
 */
export interface RaceProtocolRowDoc {
  _id: string;
  raceId: string;
  revision: number;
  order: number;
  entryId: string;
  userId: string;
  attemptId: string;
  elapsedSec: number;
  startedAt: Date;
  place: number | null;
  tied: boolean;
  status: ProtocolRowStatus;
  createdAt: Date;
}

/**
 * Запись журнала пересчётов (RC-2) — только вставка: публикация (ревизия 1), DQ и отмена DQ, применение перепроверки —
 * с ревизией; запуск перепроверки — `revision: null`. Текущая ревизия протокола — максимальная `revision` гонки.
 */
export interface RaceRecalculationDoc {
  _id: string;
  raceId: string;
  kind: RecalculationKind;
  entryId: string | null;
  revision: number | null;
  reason: string;
  actorUserId: string;
  at: Date;
}

export interface ResultsCollections {
  entries: Collection<RaceEntryDoc>;
  attempts: Collection<RaceAttemptDoc>;
  reviews: Collection<RaceAttemptReviewDoc>;
  protocolRows: Collection<RaceProtocolRowDoc>;
  recalculations: Collection<RaceRecalculationDoc>;
}

export function resultsCollections(db: Db): ResultsCollections {
  return {
    entries: db.collection<RaceEntryDoc>(RESULTS_COLLECTIONS.entries),
    attempts: db.collection<RaceAttemptDoc>(RESULTS_COLLECTIONS.attempts),
    reviews: db.collection<RaceAttemptReviewDoc>(RESULTS_COLLECTIONS.reviews),
    protocolRows: db.collection<RaceProtocolRowDoc>(RESULTS_COLLECTIONS.protocolRows),
    recalculations: db.collection<RaceRecalculationDoc>(RESULTS_COLLECTIONS.recalculations),
  };
}
