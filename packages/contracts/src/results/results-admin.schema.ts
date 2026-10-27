import { z } from 'zod';

import { ActionReason } from '../admin/members.schema.ts';
import { Uuid } from '../common.ts';
import { PageCursor, RacePhase } from '../races/race.schema.ts';
import {
  ATTEMPT_FAILURES,
  ATTEMPT_FLAG_CODES,
  ATTEMPT_ORIGINS,
  ATTEMPT_REJECTIONS,
  ATTEMPT_STATUSES,
  ATTEMPT_WITHDRAW_REASONS,
  AttemptSegment,
  ENTRY_TIERS,
  GROUP_SCHEMES,
  RACE_ENTRY_STATUSES,
  RACE_RESULT_STATUSES,
  RESULT_GROUP_KEYS,
  RESULT_UNRANKED_REASONS,
} from './results.schema.ts';

/*
 * Результаты гонки в панели (race-results-03 — чтение; race-results-05 — протокол: исключение треков, публикация,
 * экстренный пересчёт): строгие `z.enum` — панель деплоится с API. Без e-mail, координат и биометрии. Места,
 * статусы, ревизии и чек-лист считает сервер; клиент присылает намерение и причину. Справочники — только в конец.
 */

/** Строки чек-листа публикации (D-23) — всегда все, в этом порядке. */
export const PUBLISH_CHECKS = [
  'open_disputes',
  'unprocessed_tracks',
  'checks_queued',
  'checks_failed',
  'window_open',
] as const;
/** Почему гонку нельзя опубликовать независимо от чек-листа (первая подходящая). */
export const PUBLISH_STATE_BLOCKS = ['draft', 'cancelled', 'no_corridor', 'published'] as const;
/** `RESULTS_ACTION_BLOCKED.details.reason`. */
export const RESULTS_ACTION_BLOCKS = [
  'protocol_published',
  'protocol_not_published',
  'race_cancelled',
  'attempt_state',
  'row_state',
  'checks_pending',
  'recheck_not_started',
] as const;
/** Записи журнала пересчётов протокола (публикация — ревизия 1; `recheck_started` — без ревизии). */
export const RECALCULATION_KINDS = [
  'published',
  'disqualified',
  'disqualification_revoked',
  'recheck_started',
  'recheck_applied',
] as const;
/** Статус строки протокола: финальный, пересчитан (место или время изменились), дисквалифицирован. */
export const PROTOCOL_ROW_STATUSES = ['final', 'revised', 'dq'] as const;
/** Исключение трека и возврат в обработку (D-24). */
export const ATTEMPT_REVIEW_KINDS = ['excluded', 'restored'] as const;

export type PublishCheck = (typeof PUBLISH_CHECKS)[number];
export type PublishStateBlock = (typeof PUBLISH_STATE_BLOCKS)[number];
export type ResultsActionBlock = (typeof RESULTS_ACTION_BLOCKS)[number];
export type RecalculationKind = (typeof RECALCULATION_KINDS)[number];
export type ProtocolRowStatus = (typeof PROTOCOL_ROW_STATUSES)[number];
export type AttemptReviewKind = (typeof ATTEMPT_REVIEW_KINDS)[number];

/**
 * Флаг «Требует внимания» (race-results-07): код и метрика — целые проценты (`HR_*`) или отношение к медиане группы
 * (`SPEED_CLUSTER_HIGH`, до 0,001). Без пульса и мощности. Только панель.
 */
export const PanelAttemptFlag = z.object({ code: z.enum(ATTEMPT_FLAG_CODES), metric: z.number() });
export type PanelAttemptFlag = z.infer<typeof PanelAttemptFlag>;

/**
 * Источник наличия датчиков попытки: `samples` — отсчёты сегмента в файле; `declared` — признаки тренировки импорта
 * Garmin/Wahoo (поток агрегатора без рядов, ADR-0011), флаги датчиков не считаются — панель показывает «заявлен импортом».
 */
export const ATTEMPT_SENSOR_SOURCES = ['samples', 'declared'] as const;
export type AttemptSensorSource = (typeof ATTEMPT_SENSOR_SOURCES)[number];

/** Какие датчики есть в сегменте попытки (без значений); `source` нет у попыток до 07a pass 2 — `samples`. */
export const AttemptSensors = z.object({
  hr: z.boolean(),
  power: z.boolean(),
  source: z.enum(ATTEMPT_SENSOR_SOURCES).default('samples'),
});
export type AttemptSensors = z.infer<typeof AttemptSensors>;

/** Группа гонки и число строк с местом (вкладки панели). */
export const PanelResultGroup = z.object({
  key: z.enum(RESULT_GROUP_KEYS),
  ranked: z.number().int(),
});
export type PanelResultGroup = z.infer<typeof PanelResultGroup>;

/** Чек-лист публикации: `canPublish` — `blockedBy: null` и все количества нулевые («Требует внимания» не входит). */
export const PublishChecklist = z.object({
  canPublish: z.boolean(),
  blockedBy: z.enum(PUBLISH_STATE_BLOCKS).nullable(),
  /** все строки `PUBLISH_CHECKS` в их порядке */
  checklist: z.array(z.object({ code: z.enum(PUBLISH_CHECKS), count: z.number().int() })),
});
export type PublishChecklist = z.infer<typeof PublishChecklist>;

/** `GET /v1/admin/races/:raceId/results` (`races.read`) — сводка. */
export const PanelRaceResults = z.object({
  raceId: Uuid,
  lockedAt: z.iso.datetime().nullable(),
  /** схема групп гонки (race-results-07); `null` — заявок ещё не было */
  groupScheme: z.enum(GROUP_SCHEMES).nullable(),
  /** текущая версия движка сверки */
  engineVersion: z.number().int(),
  counts: z.object({
    entries: z.number().int(),
    active: z.number().int(),
    withdrawn: z.number().int(),
    ranked: z.number().int(),
    attempts: z.record(z.enum(ATTEMPT_STATUSES), z.number().int()),
    hidden: z.number().int(),
    /** финальные провалы проверки (dead-letter) */
    failed: z.number().int(),
    /** проверены прежней версией движка */
    staleEngine: z.number().int(),
    /** race-results-07: строк участников с флагами «Требует внимания» */
    attention: z.number().int(),
    /** race-results-07: время без места (START, Verified без пульса) */
    finishers: z.number().int(),
  }),
  phase: RacePhase,
  /** срок приёма заездов (конец окна + 24 ч, A5) */
  uploadClosesAt: z.iso.datetime(),
  /** опубликованный протокол; `null` — ещё нет */
  protocol: z
    .object({
      publishedAt: z.iso.datetime(),
      revision: z.number().int(),
      /** строк протокола без DQ */
      ranked: z.number().int(),
      disqualified: z.number().int(),
      /** запущена перепроверка после публикации, ещё не применена */
      recheckPending: z.boolean(),
    })
    .nullable(),
  /** последняя перепроверка треков (до или после публикации); `pending` — незавершённые проверки */
  recheck: z.object({ startedAt: z.iso.datetime(), pending: z.number().int() }).nullable(),
  publish: PublishChecklist,
});
export type PanelRaceResults = z.infer<typeof PanelRaceResults>;

export const PanelRaceAttempt = z.object({
  id: Uuid,
  entryId: Uuid,
  userId: Uuid,
  activityId: Uuid,
  origin: z.enum(ATTEMPT_ORIGINS),
  status: z.enum(ATTEMPT_STATUSES),
  hidden: z.boolean(),
  reasons: z.array(z.enum(ATTEMPT_REJECTIONS)),
  failure: z.enum(ATTEMPT_FAILURES).nullable(),
  withdrawReason: z.enum(ATTEMPT_WITHDRAW_REASONS).nullable(),
  segment: AttemptSegment.nullable(),
  engineVersion: z.number().int().nullable(),
  checkRevision: z.number().int(),
  checkAttempts: z.number().int(),
  diagnostics: z
    .object({
      corridorLengthM: z.number().int(),
      declaredDistanceM: z.number().int(),
      geometryLimited: z.boolean(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  checkedAt: z.iso.datetime().nullable(),
  /** последнее исключение или возврат (причина — только панели, райдеру не уходит) */
  review: z
    .object({ kind: z.enum(ATTEMPT_REVIEW_KINDS), reason: z.string(), at: z.iso.datetime() })
    .nullable(),
  /**
   * Публичное имя райдера (profile-02, D8) — только при имени и согласии (порт `RIDER_NAMES`), иначе `null`.
   * Обязательное: панель деплоится вместе с API.
   */
  riderName: z.string().nullable(),
  /** race-results-07: датчики сегмента; `null` — до вердикта, провал, нет сегмента, попытка до 07 */
  sensors: AttemptSensors.nullable(),
  /** флаги датчиков попытки (без `SPEED_CLUSTER_HIGH` — он у строки участника) */
  flags: z.array(PanelAttemptFlag),
  flagsVersion: z.number().int().nullable(),
});
export type PanelRaceAttempt = z.infer<typeof PanelRaceAttempt>;

/** `GET /v1/admin/races/:raceId/attempts?status&cursor&limit` — новые сверху. */
export const PanelRaceAttemptQuery = z.strictObject({
  status: z.enum(ATTEMPT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: PageCursor.optional(),
});
export type PanelRaceAttemptQuery = z.infer<typeof PanelRaceAttemptQuery>;

export const PanelRaceAttemptPage = z.object({
  items: z.array(PanelRaceAttempt),
  nextCursor: z.string().nullable(),
});
export type PanelRaceAttemptPage = z.infer<typeof PanelRaceAttemptPage>;

/** Строка «Участники» панели: место и статус результата (до публикации — живые, после — из протокола). */
export const PanelStandingRow = z.object({
  entryId: Uuid,
  userId: Uuid,
  entryStatus: z.enum(RACE_ENTRY_STATUSES),
  resultStatus: z.enum(RACE_RESULT_STATUSES),
  place: z.number().int().nullable(),
  tied: z.boolean(),
  elapsedSec: z.number().int().nullable(),
  bestAttemptId: Uuid.nullable(),
  summary: z.object({
    total: z.number().int(),
    pending: z.number().int(),
    counted: z.number().int(),
    rejectedShown: z.number().int(),
    failed: z.number().int(),
    excluded: z.number().int(),
  }),
  /**
   * Публичное имя райдера (profile-02, D8) — только при имени и согласии (порт `RIDER_NAMES`), иначе `null`.
   * Обязательное: панель деплоится вместе с API.
   */
  riderName: z.string().nullable(),
  /** race-results-07: уровень и группа заявки, причина «без места», флаги «Требует внимания» */
  tier: z.enum(ENTRY_TIERS),
  groupKey: z.enum(RESULT_GROUP_KEYS),
  unranked: z.enum(RESULT_UNRANKED_REASONS).nullable(),
  flags: z.array(PanelAttemptFlag),
});
export type PanelStandingRow = z.infer<typeof PanelStandingRow>;

/** `GET /v1/admin/races/:raceId/standings?group&attention` (race-results-07): группа и «только с флагами». */
export const PanelRaceStandingsQuery = z.strictObject({
  group: z.enum(RESULT_GROUP_KEYS).optional(),
  /** только строки с флагами */
  attention: z.enum(['true']).optional(),
});
export type PanelRaceStandingsQuery = z.infer<typeof PanelRaceStandingsQuery>;

/** `GET /v1/admin/races/:raceId/standings` (`races.read`): `protocol` — текущая ревизия снимка. */
export const PanelRaceStandings = z.object({
  source: z.enum(['live', 'protocol']),
  revision: z.number().int().nullable(),
  /** race-results-07: схема групп (`null` — заявок не было) и непустые группы по порядку справочника */
  groupScheme: z.enum(GROUP_SCHEMES).nullable(),
  groups: z.array(PanelResultGroup),
  /** заявок больше предела ответа */
  truncated: z.boolean(),
  items: z.array(PanelStandingRow),
});
export type PanelRaceStandings = z.infer<typeof PanelRaceStandings>;

export const PanelProtocolRecalculation = z.object({
  id: Uuid,
  kind: z.enum(RECALCULATION_KINDS),
  entryId: Uuid.nullable(),
  revision: z.number().int().nullable(),
  reason: z.string(),
  actor: z.object({ userId: Uuid, displayName: z.string() }),
  at: z.iso.datetime(),
});
export type PanelProtocolRecalculation = z.infer<typeof PanelProtocolRecalculation>;

/** `GET /v1/admin/races/:raceId/protocol/recalculations` — новые сверху, ≤ 100. */
export const PanelProtocolRecalculations = z.object({ items: z.array(PanelProtocolRecalculation) });
export type PanelProtocolRecalculations = z.infer<typeof PanelProtocolRecalculations>;

/** Действие панели над результатами гонки: только причина (исключение, возврат, публикация, перепроверка). */
export const ResultsActionRequest = z.strictObject({ reason: ActionReason });
export type ResultsActionRequest = z.infer<typeof ResultsActionRequest>;

/** DQ и отмена DQ участника опубликованного протокола. */
export const ProtocolEntryActionRequest = z.strictObject({ entryId: Uuid, reason: ActionReason });
export type ProtocolEntryActionRequest = z.infer<typeof ProtocolEntryActionRequest>;

/** `409 RESULTS_ACTION_BLOCKED`: причина; `count` — незавершённые проверки (`checks_pending`). */
export const ResultsActionBlockedDetails = z.object({
  reason: z.enum(RESULTS_ACTION_BLOCKS),
  count: z.number().int().optional(),
});
export type ResultsActionBlockedDetails = z.infer<typeof ResultsActionBlockedDetails>;

/** `409 RESULTS_PUBLISH_BLOCKED`: состояние гонки и чек-лист — как в `PanelRaceResults.publish`. */
export const ResultsPublishBlockedDetails = PublishChecklist.pick({
  blockedBy: true,
  checklist: true,
});
export type ResultsPublishBlockedDetails = z.infer<typeof ResultsPublishBlockedDetails>;
