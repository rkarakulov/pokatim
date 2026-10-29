import { z } from 'zod';

import { fieldError, tolerantEnum } from '../common.ts';
import { ENTRY_TIERS, RESULT_GROUP_KEYS } from '../results/results.schema.ts';

/**
 * Билеты на мероприятия (event-tickets, ADR-0023). Событие с билетами — гонка с очным стартом (`race`) или старт
 * календаря с регистрацией в «Покатим» (`calendar`). Справочники — только в конец; в ответах приложения —
 * `tolerantEnum`, в запросах и панели — строгий `z.enum`.
 */
export const TICKET_EVENT_KINDS = ['race', 'calendar'] as const;
export const TicketEventKind = z.enum(TICKET_EVENT_KINDS, { error: fieldError('INVALID') });
export type TicketEventKind = z.infer<typeof TicketEventKind>;

/**
 * Статус билета: `event_cancelled` не хранится — сервер вычисляет при чтении (гонка отменена, старт снят с публикации,
 * билеты выключены). Только в конец.
 */
export const TICKET_STATUSES = ['active', 'checked_in', 'cancelled', 'event_cancelled'] as const;
export const TicketStatus = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatus>;

/** Алфавит кода билета — Crockford base32 (без I, L, O, U): 10 символов = 50 бит. */
export const TICKET_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TICKET_CODE_LENGTH = 10;

/**
 * Код из ввода человека → канонический вид: верхний регистр, без пробелов и `-`, `I`/`L` → `1`, `O` → `0` (Crockford).
 * Сравнение и поиск — только по каноническому коду.
 */
export function normalizeTicketCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

/** Показ кода: `XXXXX-XXXXX`. */
export function formatTicketCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** Код билета в запросе (путь, check-in): `XXXXX-XXXXX` или 10 символов, регистр и `I/L/O` — как ввёл человек. */
export const TicketCode = z
  .string({ error: fieldError('INVALID') })
  .max(32, { error: 'INVALID' })
  .transform(normalizeTicketCode)
  .pipe(z.string().regex(CANONICAL_CODE, { error: 'INVALID' }));
export type TicketCode = z.infer<typeof TicketCode>;

/** Содержимое QR: `PKT1.<HMAC base64url 43>` — ни id пользователя, ни события. */
export const TicketQrPayload = z
  .string({ error: fieldError('INVALID') })
  .regex(/^PKT1\.[A-Za-z0-9_-]{43}$/, { error: 'INVALID' });
export type TicketQrPayload = z.infer<typeof TicketQrPayload>;

/** Категория участника: группа заявки гонки или дистанция старта календаря. */
const ticketCategory = <T extends z.ZodType, G extends z.ZodType>(tier: T, group: G) =>
  z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('race'), tier, groupKey: group }),
      z.object({ kind: z.literal('calendar'), distanceKm: z.number().positive().nullable() }),
    ])
    .nullable();

/** Категория в ответах панели (строгие справочники). */
export const TicketCategory = ticketCategory(z.enum(ENTRY_TIERS), z.enum(RESULT_GROUP_KEYS));
export type TicketCategory = z.infer<typeof TicketCategory>;
/** Категория в ответах приложения (незнакомая группа — `unknown`). */
export const AppTicketCategory = ticketCategory(
  tolerantEnum(ENTRY_TIERS),
  tolerantEnum(RESULT_GROUP_KEYS),
);
export type AppTicketCategory = z.infer<typeof AppTicketCategory>;

const eventSummary = <K extends z.ZodType>(kind: K) =>
  z.object({
    kind,
    id: z.uuid(),
    title: z.string(),
    /** очный старт (UTC); календарь без времени старта — начало дня по Минску */
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    place: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
  });

/** Событие билета в ответах приложения. */
export const TicketEventSummary = eventSummary(tolerantEnum(TICKET_EVENT_KINDS));
export type TicketEventSummary = z.infer<typeof TicketEventSummary>;
/** Событие билета в ответах панели. */
export const PanelTicketEventSummary = eventSummary(z.enum(TICKET_EVENT_KINDS));
export type PanelTicketEventSummary = z.infer<typeof PanelTicketEventSummary>;

/** Ссылка на свой билет: код (канонический), статус, событие прошло (QR скрыт), событие. */
export const MyTicketRef = z.object({
  code: z.string(),
  status: tolerantEnum(TICKET_STATUSES),
  past: z.boolean(),
  event: TicketEventSummary,
});
export type MyTicketRef = z.infer<typeof MyTicketRef>;

/**
 * `GET /v1/tickets` — предстоящие (по дате события ↑, до 50; без отменённых райдером) и прошедшие (последние 20 по
 * дате ↓). Без курсора: дата события живёт в модуле события (RC-T8).
 */
export const MyTickets = z.object({ upcoming: z.array(MyTicketRef), past: z.array(MyTicketRef) });
export type MyTickets = z.infer<typeof MyTickets>;

/**
 * `GET /v1/tickets/:code` — свой билет. `qr` — `PKT1.<token>` только у активного билета непрошедшего события, иначе
 * `null`. Материалы (PR C) и Wallet (PR E) — будущие необязательные поля.
 */
export const TicketView = MyTicketRef.extend({
  participantName: z.string(),
  category: AppTicketCategory,
  qr: TicketQrPayload.nullable(),
  instructions: z.string().nullable(),
  checkedInAt: z.iso.datetime().nullable(),
});
export type TicketView = z.infer<typeof TicketView>;

/** `POST /v1/calendar/:id/registration` — дистанция обязательна, если у старта их больше одной (правило сервера). */
export const CalendarRegistrationRequest = z.strictObject({
  distanceKm: z
    .number({ error: fieldError('INVALID') })
    .positive({ error: 'INVALID' })
    .optional(),
});
export type CalendarRegistrationRequest = z.infer<typeof CalendarRegistrationRequest>;

export const EVENT_REGISTRATION_STATUSES = ['active', 'cancelled'] as const;

/** `GET|POST /v1/calendar/:id/registration[/cancel]` — активная регистрация и её билет; нет — оба `null`. */
export const CalendarRegistrationState = z.object({
  registration: z
    .object({
      id: z.uuid(),
      status: tolerantEnum(EVENT_REGISTRATION_STATUSES),
      distanceKm: z.number().nullable(),
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  ticket: MyTicketRef.nullable(),
});
export type CalendarRegistrationState = z.infer<typeof CalendarRegistrationState>;

/**
 * `GET /v1/events/:kind/:eventId/ticketing` (публично, RC-T7): сводка регистрации для карточки события. Билеты не
 * включены, события нет или оно не опубликовано — `{ enabled: false }`. `registrationOpen` — только календарь (гонка:
 * заявка — через «Участвовать»).
 */
export const EventTicketingPublic = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    place: z.string().nullable(),
    address: z.string().nullable(),
    capacity: z.number().int().nullable(),
    seatsLeft: z.number().int().nullable(),
    registrationOpen: z.boolean(),
    distancesKm: z.array(z.number()),
  }),
]);
export type EventTicketingPublic = z.infer<typeof EventTicketingPublic>;

/** Причина `409 EVENT_REGISTRATION_CLOSED` (`details`). Только в конец. */
export const EVENT_REGISTRATION_CLOSED_REASONS = [
  'not_enabled',
  'unpublished',
  'started',
  'cancelled',
] as const;
export type EventRegistrationClosedReason = (typeof EVENT_REGISTRATION_CLOSED_REASONS)[number];
export const EventRegistrationClosedDetails = z.object({
  reason: tolerantEnum(EVENT_REGISTRATION_CLOSED_REASONS),
});
export type EventRegistrationClosedDetails = z.infer<typeof EventRegistrationClosedDetails>;
