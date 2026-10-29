import { randomInt } from 'node:crypto';

import {
  type EventRegistrationClosedReason,
  type Permission,
  TICKET_CODE_ALPHABET,
  TICKET_CODE_LENGTH,
  type TicketEventKind,
  type TicketStatus,
} from '@pokatim/contracts';

import type { EventTicketingDoc, TicketCategoryDoc, TicketDoc } from './tickets.collection';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Пределы и сроки билетов (event-tickets, `[ASSUMPTION]` §8 task.md). */
export const TICKETS_POLICY = {
  codeLength: TICKET_CODE_LENGTH,
  /** check-in открывается за сутки до старта */
  checkInOpensBeforeMs: 24 * HOUR,
  /** без конца события check-in закрывается через 12 ч после старта */
  defaultDurationMs: 12 * HOUR,
  /** очное событие гонки — не дольше 7 суток (`endsAt − startsAt`) */
  maxDurationMs: 7 * 24 * HOUR,
  /**
   * Регламент сверяет гонки со стартом позже `now − 61 сут`: очный старт — внутри окна гонки, окно — не длиннее 60 суток
   * (`RACE_POLICY.windowMaxMs`), +1 сутки запаса — отмена участия до закрытия окна попадает в сверку.
   */
  reconcileLookbackMs: 61 * 24 * HOUR,
  /** после закрытия окна гонки сверка ещё сутки применяет отмены (запас на отставание регламента) */
  reconcileAfterWindowMs: 24 * HOUR,
  /** «Мои билеты»: предстоящих — до 50, прошедших — последние 20; из БД — последние 200 билетов */
  listMax: 50,
  pastMax: 20,
  listFetchMax: 200,
  instructionsMax: 2000,
  /** захват отправки письма (RC-T11) */
  emailLeaseMs: 5 * MINUTE,
  /** выпуск при дубле кода — новая транзакция, не больше 3 попыток */
  issueAttempts: 3,
  /** сверка гонки — заявки пачками */
  reconcileBatch: 500,
  /** лимиты частоты */
  readLimit: { limit: 120, windowSec: 60 },
  registerLimit: { limit: 20, windowSec: 3600 },
  checkInLimit: { limit: 120, windowSec: 60 },
  /** имя участника без публичного имени профиля */
  anonymousName: 'Участник',
} as const;

/**
 * Факты события для билета (`TicketEvents`): гонка — из `RaceRegistry` и настроек билетов, календарь — из
 * `CalendarEvents` (момент старта вычисляется, RC-T2). `published` — гонка не отменена / старт опубликован;
 * `state: 'cancelled'` — не опубликовано или билеты выключены (статус `event_cancelled` не хранится).
 */
export interface EventFacts {
  kind: TicketEventKind;
  id: string;
  title: string;
  state: 'scheduled' | 'cancelled';
  published: boolean;
  startsAt: Date;
  endsAt: Date | null;
  place: string | null;
  address: string | null;
  city: string | null;
  distancesKm: number[];
  /** закрытие окна гонки (отмена участия возможна до него); календарь — `null` */
  windowClosesAt: Date | null;
  /** владелец гонки (видимость в панели); календарь — `null` */
  ownerUserId: string | null;
  ticketing: EventTicketingDoc | null;
}

/** Случайный код билета: 10 символов Crockford base32 (50 бит), не производный от id. */
export function generateTicketCode(): string {
  let code = '';
  for (let i = 0; i < TICKETS_POLICY.codeLength; i += 1) {
    code += TICKET_CODE_ALPHABET[randomInt(TICKET_CODE_ALPHABET.length)];
  }
  return code;
}

/** Окно check-in: от `startsAt − 24 ч` до `endsAt ?? startsAt + 12 ч` (исключающая граница). */
export function checkInWindow(event: Pick<EventFacts, 'startsAt' | 'endsAt'>): {
  opensAt: Date;
  closesAt: Date;
} {
  return {
    opensAt: new Date(event.startsAt.getTime() - TICKETS_POLICY.checkInOpensBeforeMs),
    closesAt: event.endsAt ?? new Date(event.startsAt.getTime() + TICKETS_POLICY.defaultDurationMs),
  };
}

/** Событие прошло (закрылось окно check-in): билет — в истории, QR скрыт. */
export function isPast(event: Pick<EventFacts, 'startsAt' | 'endsAt'>, now: Date): boolean {
  return now.getTime() >= checkInWindow(event).closesAt.getTime();
}

/**
 * Статус билета для показа: отменён райдером — `cancelled`; уже отмечен — `checked_in`; событие отменено (гонка
 * отменена, старт снят, билеты выключены) — `event_cancelled`; иначе — `active`.
 */
export function ticketStatus(
  doc: Pick<TicketDoc, 'status'>,
  event: Pick<EventFacts, 'state'>,
): TicketStatus {
  if (doc.status === 'cancelled' || doc.status === 'checked_in') return doc.status;
  return event.state === 'cancelled' ? 'event_cancelled' : 'active';
}

/** Выпускать ли новые билеты: билеты включены, событие по плану, окно check-in не закрылось (RC-T4). */
export function canIssue(event: EventFacts, now: Date): boolean {
  return event.ticketing?.enabled === true && event.state === 'scheduled' && !isPast(event, now);
}

const sameCategory = (a: TicketCategoryDoc | null, b: TicketCategoryDoc | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Заявка гонки для плана сверки (порт `RESULTS_FOR_TICKETS`). */
export interface PlanEntry {
  entryId: string;
  userId: string;
  status: 'active' | 'withdrawn';
  category: TicketCategoryDoc;
}

export interface RaceReconcilePlan {
  issue: PlanEntry[];
  cancel: string[];
  recategorize: { ticketId: string; category: TicketCategoryDoc }[];
}

/**
 * План сверки билетов гонки с заявками (чистая функция): активная заявка без билета — выпуск (если `canIssue`),
 * снятая заявка с активным билетом — отмена, сменилась группа заявки (START → Verified) — новая категория без нового
 * письма и кода (RC-T5). Отменённый билет не «воскрешает» (заявка не возобновляется; удалённому — `liveUserIds` у
 * вызывающего).
 */
export function raceReconcilePlan(
  entries: readonly PlanEntry[],
  tickets: readonly Pick<TicketDoc, '_id' | 'registrationId' | 'status' | 'category'>[],
  event: EventFacts,
  now: Date,
): RaceReconcilePlan {
  const byRegistration = new Map(tickets.map((ticket) => [ticket.registrationId, ticket] as const));
  const issuing = canIssue(event, now);
  const plan: RaceReconcilePlan = { issue: [], cancel: [], recategorize: [] };
  for (const entry of entries) {
    const ticket = byRegistration.get(entry.entryId);
    if (!ticket) {
      if (entry.status === 'active' && issuing) plan.issue.push(entry);
      continue;
    }
    if (entry.status === 'withdrawn') {
      if (ticket.status === 'active') plan.cancel.push(ticket._id);
      continue;
    }
    if (ticket.status !== 'cancelled' && !sameCategory(ticket.category, entry.category)) {
      plan.recategorize.push({ ticketId: ticket._id, category: entry.category });
    }
  }
  return plan;
}

/**
 * Можно ли зарегистрироваться (или отменить регистрацию) на старт календаря: билеты включены, старт опубликован, до
 * момента старта. Причина отказа — `EVENT_REGISTRATION_CLOSED { reason }`.
 */
export function registrationGate(
  event: EventFacts,
  now: Date,
): EventRegistrationClosedReason | null {
  if (!event.published) return 'unpublished';
  if (event.ticketing?.enabled !== true) return 'not_enabled';
  if (now.getTime() >= event.startsAt.getTime()) return 'started';
  return null;
}

/** Сотрудник для проверки доступа к событию. */
export interface EventPrincipal {
  userId: string;
  permissions: readonly Permission[];
}

/**
 * Доступ сотрудника к событию (RC-T9): `manage` — настройки билетов (гонка — `races.manage` своих или
 * `races.manage_any`; календарь — `calendar.manage`), `checkin` — отметка и список участников (право
 * `tickets.checkin` на маршруте; гонка — владелец или `races.manage_any`; календарь — `calendar.manage`). Нет права —
 * `forbidden` (403), чужое событие — `not_found` (тот же 404, что «нет события»).
 */
export function eventAccess(
  principal: EventPrincipal,
  kind: TicketEventKind,
  purpose: 'manage' | 'checkin',
  ownerUserId: string | null,
): 'ok' | 'forbidden' | 'not_found' {
  const has = (permission: Permission) => principal.permissions.includes(permission);
  if (kind === 'calendar') {
    if (has('calendar.manage')) return 'ok';
    return purpose === 'manage' ? 'forbidden' : 'not_found';
  }
  if (purpose === 'manage' && !has('races.manage') && !has('races.manage_any')) return 'forbidden';
  return has('races.manage_any') || ownerUserId === principal.userId ? 'ok' : 'not_found';
}

/** Маскированный e-mail для служебного показа без имени: `r***@gmail.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
