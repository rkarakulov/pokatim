import { z } from 'zod';

import { fieldError, MULTI_LINE, optionalText, tolerantEnum, Uuid } from '../common.ts';

/*
 * Споры по результатам гонки (race-results-06): участник с засчитанным результатом оспаривает чужой засчитанный
 * результат своей группы зачёта до отсечки D-44. Клиент присылает намерение (цель, категория, текст); право подачи,
 * сроки, анонимность (D-51) и DQ (D-43) считает сервер. Ответы приложения — `tolerantEnum` (R6), запросы — строгие.
 * Справочники — только в конец.
 */

/** D-44: приём споров закрывается за 24 ч до плановой публикации протокола. */
export const DISPUTE_FILING_LEAD_HOURS = 24;
/** D-25: решение — не раньше 12 ч после подачи. */
export const DISPUTE_DECISION_DELAY_HOURS = 12;
/** [ASSUMPTION] R2: не больше 3 открытых споров заявителя в гонке. */
export const DISPUTE_OPEN_LIMIT = 3;
export const DISPUTE_DESCRIPTION_MAX = 2000;
export const DISPUTE_RESPONSE_MIN = 3;
export const DISPUTE_RESPONSE_MAX = 2000;

/** Категории спора — подписи `disputes.category.*`. */
export const DISPUTE_CATEGORIES = [
  'speed_vs_heart_rate',
  'heart_rate_doubtful',
  'vehicle_assistance',
  'foreign_track',
  'other',
] as const;
export const DISPUTE_STATUSES = ['open', 'withdrawn', 'upheld', 'rejected'] as const;
export const DISPUTE_OUTCOMES = ['upheld', 'rejected'] as const;
/** Шаблоны причины решения для участников (внутренняя заметка — только команде). */
export const DISPUTE_DECISION_TEMPLATES = [
  'speed_implausible',
  'vehicle_assistance',
  'foreign_track',
  'rules_violation',
  'track_confirmed',
  'insufficient_evidence',
  'not_a_violation',
] as const;

export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];
export type DisputeDecisionTemplate = (typeof DISPUTE_DECISION_TEMPLATES)[number];

/** Исход → допустимые шаблоны причины. */
export const DISPUTE_TEMPLATES_BY_OUTCOME = {
  upheld: ['speed_implausible', 'vehicle_assistance', 'foreign_track', 'rules_violation'],
  rejected: ['track_confirmed', 'insufficient_evidence', 'not_a_violation'],
} as const satisfies Record<DisputeOutcome, readonly DisputeDecisionTemplate[]>;

/** Почему подать спор нельзя (`MyRaceDisputes.filing.reason`, RC-10). */
export const DISPUTE_FILE_BLOCKS = [
  'not_entered',
  'withdrawn',
  'no_counted_result',
  'disqualified',
  'cancelled',
  'protocol_published',
  'filing_closed',
  'open_limit',
  // race-results-07: результат без места (START или Verified без пульса)
  'not_ranked',
] as const;
/** `409 DISPUTE_ACTION_BLOCKED.details.reason`: причины подачи + причины действий над спором. */
export const DISPUTE_ACTION_BLOCKS = [
  ...DISPUTE_FILE_BLOCKS,
  'own_result',
  'target_not_counted',
  'already_filed',
  'not_open',
  'already_responded',
  'too_early',
] as const;
export const DISPUTE_FILING_STATUSES = ['open', 'closed', 'unavailable'] as const;
export const DISPUTE_EVENT_KINDS = ['filed', 'responded', 'withdrawn', 'decided'] as const;

export type DisputeFileBlock = (typeof DISPUTE_FILE_BLOCKS)[number];
export type DisputeActionBlock = (typeof DISPUTE_ACTION_BLOCKS)[number];
export type DisputeFilingStatus = (typeof DISPUTE_FILING_STATUSES)[number];
export type DisputeEventKind = (typeof DISPUTE_EVENT_KINDS)[number];

/** `POST /v1/races/:raceId/disputes` → `201 MyDispute`. Пустое описание — `null`. */
export const DisputeFileRequest = z.strictObject({
  targetEntryId: Uuid,
  category: z.enum(DISPUTE_CATEGORIES, { error: fieldError('REQUIRED') }),
  description: optionalText(DISPUTE_DESCRIPTION_MAX, MULTI_LINE).optional(),
});
export type DisputeFileRequest = z.infer<typeof DisputeFileRequest>;

/** `POST /v1/disputes/:disputeId/response` — ответ участника, чей результат оспорен (один раз). */
export const DisputeResponseRequest = z.strictObject({
  text: z
    .string({ error: fieldError('REQUIRED') })
    .trim()
    .min(DISPUTE_RESPONSE_MIN, { error: 'TOO_SHORT' })
    .max(DISPUTE_RESPONSE_MAX, { error: 'TOO_LONG' })
    .regex(MULTI_LINE, { error: 'INVALID' }),
});
export type DisputeResponseRequest = z.infer<typeof DisputeResponseRequest>;

/** Исход для участников: без внутренней заметки и автора. */
const DisputeDecisionView = z.object({
  outcome: tolerantEnum(DISPUTE_OUTCOMES),
  template: tolerantEnum(DISPUTE_DECISION_TEMPLATES),
  at: z.iso.datetime(),
});

/** Мой спор как заявителя — без ответа участника (D-51). */
export const MyDispute = z.object({
  id: Uuid,
  raceId: Uuid,
  targetEntryId: Uuid,
  category: tolerantEnum(DISPUTE_CATEGORIES),
  description: z.string().nullable(),
  status: tolerantEnum(DISPUTE_STATUSES),
  filedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  decision: DisputeDecisionView.nullable(),
});
export type MyDispute = z.infer<typeof MyDispute>;

/** Спор по моему результату — без заявителя и описания (D-51). `decidableBy` — плановая публикация протокола. */
export const DisputeAgainstMe = z.object({
  id: Uuid,
  raceId: Uuid,
  category: tolerantEnum(DISPUTE_CATEGORIES),
  status: tolerantEnum(DISPUTE_STATUSES),
  filedAt: z.iso.datetime(),
  decidableBy: z.iso.datetime(),
  response: z.object({ text: z.string(), at: z.iso.datetime() }).nullable(),
  canRespond: z.boolean(),
  decision: DisputeDecisionView.nullable(),
});
export type DisputeAgainstMe = z.infer<typeof DisputeAgainstMe>;

/**
 * `GET /v1/races/:raceId/disputes`: приём споров и мои споры в гонке. `filing.status`: `open` — подать можно;
 * `closed` — мог бы подать, но срок прошёл / протокол опубликован / лимит (M1); `unavailable` — действие скрыто.
 */
export const MyRaceDisputes = z.object({
  raceId: Uuid,
  filing: z.object({
    status: tolerantEnum(DISPUTE_FILING_STATUSES),
    closesAt: z.iso.datetime(),
    protocolPlannedAt: z.iso.datetime(),
    reason: tolerantEnum(DISPUTE_FILE_BLOCKS).nullable(),
  }),
  /** новые сверху */
  filed: z.array(MyDispute),
  /** новые сверху */
  against: z.array(DisputeAgainstMe),
});
export type MyRaceDisputes = z.infer<typeof MyRaceDisputes>;

/** `409 DISPUTE_ACTION_BLOCKED`: причина; `availableAt` — когда решение станет доступно (`too_early`, D-25). */
export const DisputeActionBlockedDetails = z.object({
  reason: tolerantEnum(DISPUTE_ACTION_BLOCKS),
  availableAt: z.iso.datetime().optional(),
});
export type DisputeActionBlockedDetails = z.infer<typeof DisputeActionBlockedDetails>;
