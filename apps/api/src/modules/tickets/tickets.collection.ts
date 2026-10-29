import type {
  EntryTier,
  ResultGroupKey,
  TicketEmailState,
  TicketEventKind,
} from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Билеты на мероприятия (event-tickets, ADR-0023): настройки билетов события, регистрации на старты календаря,
 * билеты. Создаёт миграция `0037_tickets`; единственный писатель — `TicketsRepository`.
 */
export const TICKETS_COLLECTIONS = {
  ticketing: 'event_ticketing',
  registrations: 'event_registrations',
  tickets: 'tickets',
} as const;

/**
 * Настройки билетов события, `_id = "<kind>:<eventId>"`. Гонка — `startsAt`/`endsAt`/`place` задаёт организатор;
 * календарь — `null` (момент и место — из старта календаря при чтении, RC-T2), `capacity` и `registeredCount` —
 * только календарь. `registeredCount` пишет регистрация (условный `$inc`), версию не трогает.
 */
export interface EventTicketingDoc {
  _id: string;
  kind: TicketEventKind;
  eventId: string;
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  place: string | null;
  address: string | null;
  instructions: string | null;
  capacity: number | null;
  registeredCount: number;
  version: number;
  updatedAt: Date;
  updatedBy: string;
}

export const ticketingIdOf = (kind: TicketEventKind, eventId: string) => `${kind}:${eventId}`;

/** Регистрация на старт календаря: одна активная на `(eventId, userId)`; после отмены — новая запись. */
export interface EventRegistrationDoc {
  _id: string;
  eventId: string;
  userId: string;
  distanceKm: number | null;
  status: 'active' | 'cancelled';
  createdAt: Date;
  cancelledAt: Date | null;
}

export type TicketCategoryDoc =
  | { kind: 'race'; tier: EntryTier; groupKey: ResultGroupKey }
  | { kind: 'calendar'; distanceKm: number | null };

/** Хранимый статус; `event_cancelled` вычисляется при чтении. */
export type StoredTicketStatus = 'active' | 'checked_in' | 'cancelled';

/**
 * Билет: `code` — случайный (Crockford, 10 символов), `qrHash` — sha256 QR-токена (сам токен — HMAC от `_id`, в БД
 * его нет). `registrationId` — id заявки гонки (`race_entries`) или регистрации календаря, уникален. `email` —
 * состояние письма «Вы зарегистрированы» (захват, RC-T11).
 */
export interface TicketDoc {
  _id: string;
  code: string;
  qrHash: string;
  kind: TicketEventKind;
  eventId: string;
  registrationId: string;
  userId: string;
  category: TicketCategoryDoc | null;
  status: StoredTicketStatus;
  checkedInAt: Date | null;
  checkedInBy: string | null;
  cancelledAt: Date | null;
  email: { state: TicketEmailState; claimedUntil: Date | null; sentAt: Date | null };
  createdAt: Date;
  version: number;
}

export interface TicketsCollections {
  ticketing: Collection<EventTicketingDoc>;
  registrations: Collection<EventRegistrationDoc>;
  tickets: Collection<TicketDoc>;
}

export function ticketsCollections(db: Db): TicketsCollections {
  return {
    ticketing: db.collection<EventTicketingDoc>(TICKETS_COLLECTIONS.ticketing),
    registrations: db.collection<EventRegistrationDoc>(TICKETS_COLLECTIONS.registrations),
    tickets: db.collection<TicketDoc>(TICKETS_COLLECTIONS.tickets),
  };
}
