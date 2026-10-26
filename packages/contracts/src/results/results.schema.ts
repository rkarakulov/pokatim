import { z } from 'zod';

import { tolerantEnum, Uuid } from '../common.ts';
import { PageCursor } from '../races/race.schema.ts';
import {
  TRACK_FAILURE_CODES,
  TRACK_SOURCES,
  TRACK_UPLOAD_STATUSES,
} from '../tracks/track-upload.schema.ts';

/*
 * Участие в гонке и результаты (race-results-03): заявка, попытки, предварительная таблица. Ответы приложения —
 * `tolerantEnum` (R6). Статусы, вердикты, время и места считает только сервер; клиент присылает намерение
 * («участвую», «этот заезд», «отменяю»). Справочники — только в конец.
 */

export const RACE_ENTRY_STATUSES = ['active', 'withdrawn'] as const;
export const ATTEMPT_ORIGINS = ['auto', 'explicit'] as const;
export const ATTEMPT_STATUSES = [
  'queued',
  'checking',
  'counted',
  'rejected',
  'failed',
  'withdrawn',
  // race-results-05: исключена панелью до публикации протокола (D-24)
  'excluded',
] as const;
/**
 * Причины отказа попытки = `CORRIDOR_REJECTIONS` движка (`@pokatim/tracks/parse`) + `implausible`. contracts от
 * движка не зависит: совпадение держит тест-сторож в `apps/api`. Только в конец.
 */
export const ATTEMPT_REJECTIONS = [
  'no_start',
  'no_finish',
  'wrong_direction',
  'missed_section',
  'gps_gap',
  'off_corridor',
  'outside_window',
  'sparse_recording',
  'implausible',
] as const;
export const ATTEMPT_FAILURES = [
  'storage',
  'timeout',
  'unreadable',
  'corridor_invalid',
  'error',
] as const;
export const ATTEMPT_WITHDRAW_REASONS = ['activity_removed', 'not_primary'] as const;
/**
 * Статус результата участника (считается при чтении). race-results-05: после публикации — статус строки протокола
 * (`final`, `dq` — дисквалифицирован, `revised` — пересчитан).
 */
export const RACE_RESULT_STATUSES = [
  'none',
  'pending',
  'provisional',
  'not_counted',
  'dns',
  'withdrawn',
  'final',
  'dq',
  'revised',
] as const;
/** Причины недоступности действий участия (`MyRaceEntry.actions.reasons`). */
export const RACE_ENTRY_BLOCK_REASONS = [
  'no_corridor',
  'cancelled',
  'entries_closed',
  'withdrawn',
  'not_entered',
  'window_not_open',
  'window_closed',
  'upload_closed',
  'attempt_limit',
] as const;
/** Группа зачёта (A3): одна в v1; кластеры — слайс 07. */
export const RESULT_GROUP_KEYS = ['overall'] as const;

export type RaceEntryStatus = (typeof RACE_ENTRY_STATUSES)[number];
export type AttemptOrigin = (typeof ATTEMPT_ORIGINS)[number];
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type AttemptRejection = (typeof ATTEMPT_REJECTIONS)[number];
export type AttemptFailure = (typeof ATTEMPT_FAILURES)[number];
export type AttemptWithdrawReason = (typeof ATTEMPT_WITHDRAW_REASONS)[number];
export type RaceResultStatus = (typeof RACE_RESULT_STATUSES)[number];
export type RaceEntryBlockReason = (typeof RACE_ENTRY_BLOCK_REASONS)[number];
export type ResultGroupKey = (typeof RESULT_GROUP_KEYS)[number];

/**
 * `POST /v1/races/:raceId/attempts`: «выбрать свой заезд» (`activityId`) или «загрузить в гонку» после
 * `POST /v1/tracks/uploads` (`uploadId`). Ровно одно поле.
 */
export const AttemptRequest = z.union([
  z.strictObject({ activityId: Uuid }),
  z.strictObject({ uploadId: Uuid }),
]);
export type AttemptRequest = z.infer<typeof AttemptRequest>;

/** Сегмент между воротами — метрики без координат и датчиков. */
export const AttemptSegment = z.object({
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  elapsedSec: z.number().int(),
  distanceM: z.number().int(),
  offCorridorM: z.number().int(),
  offCorridorShare: z.number(),
  maxExcursionM: z.number().int(),
  coverage: z.number(),
});
export type AttemptSegment = z.infer<typeof AttemptSegment>;

/** Попытка в «моём участии»: только видимые райдеру (скрытые автоматические несовпадения и снятые — нет). */
export const MyAttempt = z.object({
  id: Uuid,
  origin: tolerantEnum(ATTEMPT_ORIGINS),
  status: tolerantEnum(ATTEMPT_STATUSES),
  /** [] у засчитанной; первый — основной */
  reasons: z.array(tolerantEnum(ATTEMPT_REJECTIONS)),
  segment: AttemptSegment.nullable(),
  isBest: z.boolean(),
  activity: z.object({
    id: Uuid,
    startedAt: z.iso.datetime(),
    source: tolerantEnum(TRACK_SOURCES),
    elapsedSec: z.number().int(),
    distanceM: z.number().int(),
  }),
  createdAt: z.iso.datetime(),
  checkedAt: z.iso.datetime().nullable(),
});
export type MyAttempt = z.infer<typeof MyAttempt>;

/** Запрос «загрузить в гонку», файл которого ещё не стал активностью (или не принят). */
export const PendingUpload = z.object({
  uploadId: Uuid,
  status: tolerantEnum(TRACK_UPLOAD_STATUSES),
  failure: tolerantEnum(TRACK_FAILURE_CODES).nullable(),
});
export type PendingUpload = z.infer<typeof PendingUpload>;

/**
 * `GET /v1/races/:raceId/entry` (и ответ мутаций участия), `no-store`. `entry: null` — не заявлен. Место до
 * публикации протокола — предварительное (считается при чтении), после — из текущей ревизии протокола.
 */
export const MyRaceEntry = z.object({
  raceId: Uuid,
  entry: z
    .object({
      id: Uuid,
      status: tolerantEnum(RACE_ENTRY_STATUSES),
      createdAt: z.iso.datetime(),
      withdrawnAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  result: z.object({
    status: tolerantEnum(RACE_RESULT_STATUSES),
    elapsedSec: z.number().int().nullable(),
    place: z.number().int().nullable(),
    tied: z.boolean(),
    /** строк в группе зачёта */
    ranked: z.number().int(),
    group: tolerantEnum(RESULT_GROUP_KEYS),
  }),
  /** видимые, новые сверху, ≤ 30 */
  attempts: z.array(MyAttempt),
  pendingUploads: z.array(PendingUpload),
  uploadClosesAt: z.iso.datetime(),
  actions: z.object({
    canEnter: z.boolean(),
    canWithdraw: z.boolean(),
    canAddAttempt: z.boolean(),
    reasons: z.array(tolerantEnum(RACE_ENTRY_BLOCK_REASONS)),
  }),
});
export type MyRaceEntry = z.infer<typeof MyRaceEntry>;

/** `GET /v1/races/:raceId/attempt-candidates`: свои основные активности, пересекающие окно (≤ 50). */
export const AttemptCandidates = z.object({
  items: z.array(
    z.object({
      activityId: Uuid,
      startedAt: z.iso.datetime(),
      source: tolerantEnum(TRACK_SOURCES),
      elapsedSec: z.number().int(),
      distanceM: z.number().int(),
      attempted: z.boolean(),
    }),
  ),
});
export type AttemptCandidates = z.infer<typeof AttemptCandidates>;

export const RACE_RESULTS_PAGE_MAX = 100;

/** `GET /v1/races/:raceId/results` — публичная предварительная таблица. Лишние ключи — 400. */
export const RaceResultsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(RACE_RESULTS_PAGE_MAX).default(50),
  cursor: PageCursor.optional(),
});
export type RaceResultsQuery = z.infer<typeof RaceResultsQuery>;

/**
 * Строка таблицы; своя строка — по `entryId` из «моего участия». Имя — только при явном согласии райдера (P1,
 * profile-rider-name); иначе `null`, приложение — «Участник».
 */
export const RaceResultRow = z.object({
  entryId: Uuid,
  place: z.number().int(),
  /** место разделено (ничья до секунды): «=N» */
  tied: z.boolean(),
  elapsedSec: z.number().int(),
  /** публичное имя из профиля; старый сервер поля не знает — `null` */
  riderName: z.string().nullable().default(null),
});
export type RaceResultRow = z.infer<typeof RaceResultRow>;

/** Статус таблицы: предварительная или из опубликованного протокола (race-results-05). */
export const RACE_RESULTS_STATUSES = ['provisional', 'final'] as const;

export const RaceResultsPage = z.object({
  group: tolerantEnum(RESULT_GROUP_KEYS),
  status: tolerantEnum(RACE_RESULTS_STATUSES),
  ranked: z.number().int(),
  entries: z.number().int(),
  items: z.array(RaceResultRow),
  nextCursor: z.string().nullable(),
});
export type RaceResultsPage = z.infer<typeof RaceResultsPage>;
