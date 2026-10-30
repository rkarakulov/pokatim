import { z } from 'zod';

import { fieldError, MULTI_LINE, optionalText, SINGLE_LINE, Uuid, Version } from '../common.ts';
import { UtcMinute } from '../time.ts';
import {
  PanelTicketEventSummary,
  TICKET_EVENT_KINDS,
  TicketCategory,
  TicketCode,
  TicketQrPayload,
  TicketStatus,
} from './ticket.schema.ts';

/** Панель «Протокол»: настройки билетов события, check-in, участники (строгие справочники). */

export const TICKETING_INSTRUCTIONS_MAX = 2000;
export const TICKETING_PLACE_MAX = 200;
export const TICKETING_ADDRESS_MAX = 300;
export const TICKETING_CAPACITY_MAX = 100_000;

/** Напоминания участникам (PR D): до 3 правил «за N часов до старта», текст организатора. */
export const EVENT_REMINDERS_MAX = 3;
export const EVENT_REMINDER_OFFSET_MIN_HOURS = 1;
export const EVENT_REMINDER_OFFSET_MAX_HOURS = 168;
export const EVENT_REMINDER_TEXT_MAX = 500;

/** Правило в запросе: `id` — существующего правила (без `id` — новое, id даёт сервер). */
export const EventReminderInput = z.strictObject({
  id: z.uuid({ error: 'INVALID' }).optional(),
  offsetHours: z
    .number({ error: fieldError('INVALID') })
    .int({ error: 'INVALID' })
    .min(EVENT_REMINDER_OFFSET_MIN_HOURS, { error: 'INVALID' })
    .max(EVENT_REMINDER_OFFSET_MAX_HOURS, { error: 'INVALID' }),
  text: z
    .string({ error: fieldError('REQUIRED') })
    .trim()
    .min(1, { error: 'REQUIRED', abort: true })
    .max(EVENT_REMINDER_TEXT_MAX, { error: 'TOO_LONG' })
    .regex(MULTI_LINE, { error: 'INVALID' }),
});
export type EventReminderInput = z.infer<typeof EventReminderInput>;

/**
 * Правило в ответе панели: `sendAt` — время отправки по текущему старту (`null` — нет старта), `sentAt`/`sentCount` —
 * отправка по этому времени, `late` — правило задано после своего времени отправки и не уйдёт (RC-D5).
 */
export const EventReminder = z.object({
  id: z.uuid(),
  offsetHours: z.number().int(),
  text: z.string(),
  sendAt: z.iso.datetime().nullable(),
  sentAt: z.iso.datetime().nullable(),
  sentCount: z.number().int().nonnegative(),
  late: z.boolean(),
});
export type EventReminder = z.infer<typeof EventReminder>;

/** Путь `/v1/admin/events/:kind/:eventId/*`. */
export const AdminEventParams = z.strictObject({
  kind: z.enum(TICKET_EVENT_KINDS, { error: fieldError('INVALID') }),
  eventId: Uuid,
});
export type AdminEventParams = z.infer<typeof AdminEventParams>;

/**
 * Настройки билетов события. Гонка — очный старт, конец и место задаёт организатор; календарь — дата, время и место
 * из старта календаря (сервер вычисляет при чтении, RC-T2), `capacity` — только календарь. Нет настроек —
 * `version: 0`, `enabled: false`.
 */
export const EventTicketingSettings = z.object({
  kind: z.enum(TICKET_EVENT_KINDS),
  eventId: z.uuid(),
  enabled: z.boolean(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  place: z.string().nullable(),
  address: z.string().nullable(),
  instructions: z.string().nullable(),
  capacity: z.number().int().nullable(),
  version: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime().nullable(),
  /** календарь: активные регистрации */
  registeredCount: z.number().int().nonnegative(),
  activeTickets: z.number().int().nonnegative(),
  checkedIn: z.number().int().nonnegative(),
  /** напоминания участникам (PR D) */
  reminders: z.array(EventReminder),
});
export type EventTicketingSettings = z.infer<typeof EventTicketingSettings>;

/**
 * `PUT /v1/admin/events/:kind/:eventId/ticketing` — изменённые поля + ожидаемая `version` (устаревшая — `409
 * CONFLICT`). Гонка: `startsAt` и `place` обязательны при `enabled`, `startsAt` — внутри окна гонки, `capacity` нет;
 * календарь: `startsAt`/`endsAt`/`place` нет (берутся из старта). Правила по `kind` — сервер (`VALIDATION_FAILED`).
 */
export const EventTicketingUpdate = z.strictObject({
  enabled: z.boolean({ error: fieldError('REQUIRED') }),
  startsAt: UtcMinute.nullable().optional(),
  endsAt: UtcMinute.nullable().optional(),
  place: optionalText(TICKETING_PLACE_MAX, SINGLE_LINE).optional(),
  address: optionalText(TICKETING_ADDRESS_MAX, SINGLE_LINE).optional(),
  instructions: optionalText(TICKETING_INSTRUCTIONS_MAX, MULTI_LINE).optional(),
  capacity: z
    .number({ error: fieldError('INVALID') })
    .int({ error: 'INVALID' })
    .min(1, { error: 'INVALID' })
    .max(TICKETING_CAPACITY_MAX, { error: 'INVALID' })
    .nullable()
    .optional(),
  /** PR D: полный список правил; нет поля — правила не трогаются (RC-T15) */
  reminders: z
    .array(EventReminderInput)
    .max(EVENT_REMINDERS_MAX, { error: 'INVALID' })
    .superRefine((rules, ctx) => {
      rules.forEach((rule, index) => {
        if (rules.findIndex((other) => other.offsetHours === rule.offsetHours) < index) {
          ctx.addIssue({ code: 'custom', message: 'INVALID', path: [index, 'offsetHours'] });
        }
      });
    })
    .optional(),
  version: Version,
});
export type EventTicketingUpdate = z.infer<typeof EventTicketingUpdate>;

/** Причина `409 TICKETING_INVALID_STATE` (`details`). Только в конец. */
export const TICKETING_INVALID_STATE_REASONS = [
  'start_time_required',
  'capacity_below_registered',
  'event_cancelled',
  // PR C: предел материалов (20) и PDF (10) события
  'materials_limit',
  'files_limit',
] as const;
export type TicketingInvalidStateReason = (typeof TICKETING_INVALID_STATE_REASONS)[number];
export const TicketingInvalidStateDetails = z.object({
  reason: z.enum(TICKETING_INVALID_STATE_REASONS),
});
export type TicketingInvalidStateDetails = z.infer<typeof TicketingInvalidStateDetails>;

/** `POST /v1/admin/tickets/lookup|check-in` — содержимое QR или код, введённый вручную (ровно одно поле). */
export const CheckInRequest = z.union([
  z.strictObject({ qr: TicketQrPayload }),
  z.strictObject({ code: TicketCode }),
]);
export type CheckInRequest = z.infer<typeof CheckInRequest>;

/**
 * Исход проверки билета: `ready` — можно отметить (только lookup), `checked_in` — отмечен этим запросом, остальные —
 * отказ (бизнес-исход, `200`). Нет билета или чужое событие — `404`, нет права — `403`. Только в конец.
 */
export const CHECK_IN_OUTCOMES = [
  'ready',
  'checked_in',
  'already_checked_in',
  'cancelled',
  'event_cancelled',
  'outside_window',
] as const;
export const CheckInOutcome = z.enum(CHECK_IN_OUTCOMES);
export type CheckInOutcome = z.infer<typeof CheckInOutcome>;

export const CheckInView = z.object({
  outcome: CheckInOutcome,
  ticket: z.object({
    code: z.string(),
    status: TicketStatus,
    participantName: z.string(),
    category: TicketCategory,
    event: PanelTicketEventSummary,
    checkedInAt: z.iso.datetime().nullable(),
    /** имя сотрудника в панели; `null` — не отмечен */
    checkedInBy: z.string().nullable(),
  }),
});
export type CheckInView = z.infer<typeof CheckInView>;

/** Состояние письма «Вы зарегистрированы» (колонка «Письмо»): провал — видимый, RC-T11. */
export const TICKET_EMAIL_STATES = ['pending', 'sending', 'sent', 'skipped', 'failed'] as const;
export const TicketEmailState = z.enum(TICKET_EMAIL_STATES);
export type TicketEmailState = z.infer<typeof TicketEmailState>;

/** `GET /v1/admin/events/:kind/:eventId/tickets` — курсор `_id` последнего билета страницы. */
export const EventTicketsQuery = z.strictObject({
  cursor: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type EventTicketsQuery = z.infer<typeof EventTicketsQuery>;

export const EventTicketRow = z.object({
  code: z.string(),
  status: TicketStatus,
  participantName: z.string(),
  category: TicketCategory,
  checkedInAt: z.iso.datetime().nullable(),
  emailState: TicketEmailState,
});
export type EventTicketRow = z.infer<typeof EventTicketRow>;

export const EventTicketsPage = z.object({
  items: z.array(EventTicketRow),
  nextCursor: z.uuid().nullable(),
});
export type EventTicketsPage = z.infer<typeof EventTicketsPage>;
