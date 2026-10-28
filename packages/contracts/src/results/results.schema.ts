import { z } from 'zod';

import { tolerantEnum, Uuid } from '../common.ts';
import { LonLat } from '../races/race-route.schema.ts';
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
  // race-results-07: время засчитано, места нет (START или Verified без пульса)
  'finisher',
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
  // race-results-06: открыт спор по своему результату (D-39); результат дисквалифицирован по спору (RC-6)
  'dispute_open',
  'disqualified',
] as const;
/**
 * Группа зачёта (A3). `overall` — гонки до race-results-07 и START; пол × возраст (race-results-07) — Verified.
 * Подписи — `results.group.*`.
 */
export const RESULT_GROUP_KEYS = [
  'overall',
  'm_u40',
  'm_40_49',
  'm_50p',
  'w_u40',
  'w_40_49',
  'w_50p',
] as const;
/** Уровень заявки (race-results-07): Verified — анкета и место в группе; START — время без места. */
export const ENTRY_TIERS = ['verified', 'start'] as const;
/** Схема групп гонки: `overall` — гонки до race-results-07 (одна группа), `gender_age` — пол × возраст. */
export const GROUP_SCHEMES = ['overall', 'gender_age'] as const;
/** Пол анкеты Verified (только для группы зачёта). */
export const RIDER_GENDERS = ['m', 'w'] as const;
/** Флаги «Требует внимания» (только панель): кластер скорости, развязка мощности и пульса, пропуски пульса. */
export const ATTEMPT_FLAG_CODES = ['SPEED_CLUSTER_HIGH', 'HR_POWER_DECOUPLED', 'HR_GAPS'] as const;
/** Почему засчитанное время без места: заявка START или у Verified нет попытки с пульсом. */
export const RESULT_UNRANKED_REASONS = ['start', 'no_heart_rate'] as const;

export type RaceEntryStatus = (typeof RACE_ENTRY_STATUSES)[number];
export type AttemptOrigin = (typeof ATTEMPT_ORIGINS)[number];
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type AttemptRejection = (typeof ATTEMPT_REJECTIONS)[number];
export type AttemptFailure = (typeof ATTEMPT_FAILURES)[number];
export type AttemptWithdrawReason = (typeof ATTEMPT_WITHDRAW_REASONS)[number];
export type RaceResultStatus = (typeof RACE_RESULT_STATUSES)[number];
export type RaceEntryBlockReason = (typeof RACE_ENTRY_BLOCK_REASONS)[number];
export type ResultGroupKey = (typeof RESULT_GROUP_KEYS)[number];
export type EntryTier = (typeof ENTRY_TIERS)[number];
export type GroupScheme = (typeof GROUP_SCHEMES)[number];
export type RiderGender = (typeof RIDER_GENDERS)[number];
export type AttemptFlagCode = (typeof ATTEMPT_FLAG_CODES)[number];
export type ResultUnrankedReason = (typeof RESULT_UNRANKED_REASONS)[number];

/**
 * `POST /v1/races/:raceId/entry` (race-results-07): уровень и группа — намерение, правила проверяет сервер. Пусто/нет
 * тела — новая заявка START в схеме `gender_age` (v1-поведение `verified`/`overall` в схеме `overall`); на
 * существующей заявке отсутствие `tier` — без изменений. `tier: 'verified'` на активной START — повышение.
 */
export const RaceEntryRequest = z
  .strictObject({
    tier: z.enum(ENTRY_TIERS).optional(),
    groupKey: z.enum(RESULT_GROUP_KEYS).optional(),
  })
  .optional();
export type RaceEntryRequest = z.infer<typeof RaceEntryRequest>;

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

export const MY_ATTEMPT_TRACK_MAX_POINTS = 1000;
export const MY_ATTEMPT_TRACK_MAX_RUNS = 100;
/** Разметка трека готова / проверка идёт / разметки нет (провал, попытка до maps-02, линия не совпала). */
export const ATTEMPT_TRACK_MARKS = ['ready', 'pending', 'unavailable'] as const;

/** Участок линии трека: дробные индексы вершин `i + t` (`0 ≤ t < 1`), `from ≤ to`. */
export const TrackMapRun = z.object({ from: z.number().min(0), to: z.number().min(0) });
export type TrackMapRun = z.infer<typeof TrackMapRun>;

/**
 * `GET /v1/races/:raceId/entry/attempts/:attemptId/track` (maps-02), `no-store`, только владельцу: линия своей
 * активности (упрощённая, ≤ 1000 точек) и разметка сегмента и схода, посчитанная worker при сверке. Без id
 * активности, времени точек и датчиков. `pending`/`unavailable` — `segment: null`, `offRuns: []`.
 */
export const MyAttemptTrack = z.object({
  attemptId: Uuid,
  line: z.array(LonLat).min(2).max(MY_ATTEMPT_TRACK_MAX_POINTS),
  segment: TrackMapRun.nullable(),
  offRuns: z.array(TrackMapRun).max(MY_ATTEMPT_TRACK_MAX_RUNS),
  marks: tolerantEnum(ATTEMPT_TRACK_MARKS),
});
export type MyAttemptTrack = z.infer<typeof MyAttemptTrack>;

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
/** Блок «Verified» участия (race-results-07); `null` — схема `overall` (уровень не выбирается). */
export const MyVerifiedState = z.object({
  /** анкета заполнена (и согласие дано) */
  profileReady: z.boolean(),
  /** своя группа по анкете для этой гонки; `null` — анкеты нет */
  ownGroup: tolerantEnum(RESULT_GROUP_KEYS).nullable(),
  /** разрешённые группы: своя первой, затем младшие своего пола; `null` — анкеты нет */
  groupOptions: z.array(tolerantEnum(RESULT_GROUP_KEYS)).nullable(),
});
export type MyVerifiedState = z.infer<typeof MyVerifiedState>;

export const MyRaceEntry = z.object({
  raceId: Uuid,
  /** схема групп гонки (race-results-07); гонка без заявок — `gender_age` (её получит первая заявка) */
  groupScheme: tolerantEnum(GROUP_SCHEMES).default('overall'),
  entry: z
    .object({
      id: Uuid,
      status: tolerantEnum(RACE_ENTRY_STATUSES),
      createdAt: z.iso.datetime(),
      withdrawnAt: z.iso.datetime().nullable(),
      tier: tolerantEnum(ENTRY_TIERS).nullable().default(null),
      groupKey: tolerantEnum(RESULT_GROUP_KEYS).nullable().default(null),
    })
    .nullable(),
  result: z.object({
    status: tolerantEnum(RACE_RESULT_STATUSES),
    elapsedSec: z.number().int().nullable(),
    place: z.number().int().nullable(),
    tied: z.boolean(),
    /** строк в группе зачёта */
    ranked: z.number().int(),
    /** группа заявки (нет заявки — `overall`) */
    group: tolerantEnum(RESULT_GROUP_KEYS),
    /** почему время без места (`finisher`); `null` — место есть или результата нет */
    unranked: tolerantEnum(RESULT_UNRANKED_REASONS).nullable().default(null),
  }),
  verified: MyVerifiedState.nullable().default(null),
  /** видимые, новые сверху, ≤ 30 */
  attempts: z.array(MyAttempt),
  pendingUploads: z.array(PendingUpload),
  uploadClosesAt: z.iso.datetime(),
  actions: z.object({
    canEnter: z.boolean(),
    canWithdraw: z.boolean(),
    canAddAttempt: z.boolean(),
    reasons: z.array(tolerantEnum(RACE_ENTRY_BLOCK_REASONS)),
    /** START → Verified: активная START-заявка, окно `upcoming|open`, схема `gender_age` (анкета — `verified`) */
    canUpgrade: z.boolean().default(false),
    /** story-cards: карточка для сторис доступна — `storyCardEligible` сервера (старый сервер — `false`) */
    canShareStory: z.boolean().default(false),
  }),
});
export type MyRaceEntry = z.infer<typeof MyRaceEntry>;

/** `409 RACE_WITHDRAW_CLOSED` и `409 ATTEMPT_UPLOAD_CLOSED`: причина из `RACE_ENTRY_BLOCK_REASONS`. */
export const RaceEntryBlockedDetails = z.object({ reason: tolerantEnum(RACE_ENTRY_BLOCK_REASONS) });
export type RaceEntryBlockedDetails = z.infer<typeof RaceEntryBlockedDetails>;

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
  /**
   * Группа зачёта (race-results-07); нет — `overall` в схеме `overall`, иначе первая непустая. Клиент шлёт только
   * если прошлый ответ дал непустой `groups` (старый сервер ответит 400 на лишний ключ).
   */
  group: z.enum(RESULT_GROUP_KEYS).optional(),
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
  /** непустые группы гонки по порядку справочника (вкладки); старый сервер — `[]` */
  groups: z
    .array(z.object({ key: tolerantEnum(RESULT_GROUP_KEYS), ranked: z.number().int() }))
    .default([]),
  /** строк таблицы финишёров (вкладка видна при > 0) */
  finishers: z.number().int().default(0),
});
export type RaceResultsPage = z.infer<typeof RaceResultsPage>;

/** `GET /v1/races/:raceId/finishers` (race-results-07): START и Verified без пульса — время без места. */
export const RaceFinishersQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(RACE_RESULTS_PAGE_MAX).default(50),
  cursor: PageCursor.optional(),
});
export type RaceFinishersQuery = z.infer<typeof RaceFinishersQuery>;

/** Строка финишёров: без места; имя — по правилам `RaceResultRow` (P1). */
export const RaceFinisherRow = z.object({
  entryId: Uuid,
  elapsedSec: z.number().int(),
  riderName: z.string().nullable().default(null),
  unranked: tolerantEnum(RESULT_UNRANKED_REASONS),
});
export type RaceFinisherRow = z.infer<typeof RaceFinisherRow>;

export const RaceFinishersPage = z.object({
  total: z.number().int(),
  items: z.array(RaceFinisherRow),
  nextCursor: z.string().nullable(),
});
export type RaceFinishersPage = z.infer<typeof RaceFinishersPage>;
