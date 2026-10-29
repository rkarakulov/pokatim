import { Inject, Injectable } from '@nestjs/common';
import type {
  EventTicketingSettings,
  EventTicketingUpdate,
  EventTicketsPage,
  EventTicketsQuery,
  TicketEventKind,
  TicketingInvalidStateDetails,
  TicketingInvalidStateReason,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { PanelAudit, type PanelPrincipal } from '../panel';
import { ParticipantNames } from './participant-names';
import { TicketEvents } from './ticket-events';
import { categoryView } from './ticket-views';
import { type EventTicketingDoc, ticketingIdOf } from './tickets.collection';
import { type EventFacts, eventAccess, ticketStatus } from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

const invalidState = (reason: TicketingInvalidStateReason) => {
  const details: TicketingInvalidStateDetails = { reason };
  return domainError('TICKETING_INVALID_STATE', 409, details);
};

type FieldIssue = { path: string; code: 'REQUIRED' | 'INVALID' | 'DATE_ORDER' };
const fieldsError = (fields: FieldIssue[]) => domainError('VALIDATION_FAILED', 400, { fields });

const SETTINGS_FIELDS = [
  'enabled',
  'startsAt',
  'endsAt',
  'place',
  'address',
  'instructions',
  'capacity',
] as const;
type SettingsFields = Pick<EventTicketingDoc, (typeof SETTINGS_FIELDS)[number]>;

const same = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

const dateOrNull = (value: string | null) => (value === null ? null : new Date(value));

/** Событие панели: факты + доступ проверен. */
interface PanelEvent {
  facts: EventFacts;
  /** окно гонки (проверка очного старта, RC-T3); календарь — `null` */
  window: { startsAt: Date; closesAt: Date } | null;
  /** время старта календаря задано (RC-T2) */
  hasStartTime: boolean;
}

/**
 * Настройки билетов события и список участников в панели (event-tickets). Право зависит от `kind` (RC-T9): маршрут
 * под `PanelGuard`, проверка — `eventAccess` (нет права — 403, чужая гонка — 404). Правка — транзакция: версия →
 * правила (RC-T2/T3/T6) → запись → журнал `tickets.settings_updated`; без изменений — без записи и журнала.
 */
@Injectable()
export class TicketingAdminService {
  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
    private readonly names: ParticipantNames,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
  ): Promise<EventTicketingSettings> {
    const event = await this.event(principal, kind, eventId, 'manage');
    return this.settings(event.facts, event.facts.ticketing);
  }

  async update(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    body: EventTicketingUpdate,
  ): Promise<EventTicketingSettings> {
    const event = await this.event(principal, kind, eventId, 'manage');
    const { facts } = event;
    let written: EventTicketingDoc | null = null;
    try {
      written = await this.transactions.run(async (tx) => {
        const current = (await this.repository.findTicketing(kind, eventId, tx)) ?? null;
        if ((current?.version ?? 0) !== body.version) throw domainError('CONFLICT', 409);
        const next = this.next(event, current, body);
        const changed = SETTINGS_FIELDS.filter(
          (field) => !same(current?.[field] ?? (field === 'enabled' ? false : null), next[field]),
        );
        if (changed.length === 0) return current;
        const now = this.clock.now();
        const doc: EventTicketingDoc = {
          _id: ticketingIdOf(kind, eventId),
          kind,
          eventId,
          ...next,
          registeredCount: current?.registeredCount ?? 0,
          version: body.version + 1,
          updatedAt: now,
          updatedBy: principal.userId,
        };
        if (!(await this.repository.upsertTicketing(tx, doc, body.version))) {
          throw domainError('CONFLICT', 409);
        }
        await this.audit.append(tx, {
          action: 'tickets.settings_updated',
          actor: { kind: 'user', userId: principal.userId },
          subject: {
            kind: kind === 'race' ? 'race' : 'calendar_start',
            id: eventId,
            label: facts.title,
          },
          details: { changedFields: [...changed] },
        });
        return doc;
      });
    } catch (error) {
      // две первые записи настроек одновременно — вторая по устаревшей версии
      if (isDuplicateKey(error, '_id_')) throw domainError('CONFLICT', 409);
      throw error;
    }
    const fresh = await this.events.resolve(kind, eventId);
    return this.settings(fresh ?? facts, written);
  }

  /** Билеты события (`tickets.checkin`): курсор — `_id` последнего билета страницы. */
  async participants(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    query: EventTicketsQuery,
  ): Promise<EventTicketsPage> {
    const { facts } = await this.event(principal, kind, eventId, 'checkin');
    const docs = await this.repository.ticketsOfEvent(
      kind,
      eventId,
      query.cursor ?? null,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const names = await this.names.of(page.map((doc) => doc.userId));
    return {
      items: page.map((doc) => ({
        code: doc.code,
        status: ticketStatus(doc, facts),
        participantName: names.get(doc.userId) ?? '',
        category: categoryView(doc.category),
        checkedInAt: doc.checkedInAt?.toISOString() ?? null,
        emailState: doc.email.state,
      })),
      nextCursor: docs.length > query.limit ? (page.at(-1)?._id ?? null) : null,
    };
  }

  /** Событие с проверкой доступа: нет права — 403, нет или чужое — 404. */
  private async event(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    purpose: 'manage' | 'checkin',
  ): Promise<PanelEvent> {
    // право по виду события проверяется до чтения: без права 403 не выдаёт существование события
    if (eventAccess(principal, kind, purpose, principal.userId) === 'forbidden') {
      throw domainError('FORBIDDEN', 403);
    }
    const facts = await this.events.resolve(kind, eventId);
    if (!facts || eventAccess(principal, kind, purpose, facts.ownerUserId) !== 'ok') {
      throw domainError('NOT_FOUND', 404);
    }
    if (kind === 'race') {
      const race = await this.events.race(eventId);
      return {
        facts,
        window: race ? { startsAt: race.windowStartsAt, closesAt: race.closesAt } : null,
        hasStartTime: true,
      };
    }
    const start = await this.events.calendarStart(eventId);
    return { facts, window: null, hasStartTime: start?.startTime != null };
  }

  /** Новые значения полей с правилами по виду события (RC-T2, RC-T3, RC-T6). */
  private next(
    event: PanelEvent,
    current: EventTicketingDoc | null,
    body: EventTicketingUpdate,
  ): SettingsFields {
    const { facts } = event;
    const pick = <T>(value: T | undefined, fallback: T) => (value === undefined ? fallback : value);
    const issues: FieldIssue[] = [];
    const next: SettingsFields = {
      enabled: body.enabled,
      startsAt: null,
      endsAt: null,
      place: null,
      address: pick(body.address, current?.address ?? null),
      instructions: pick(body.instructions, current?.instructions ?? null),
      capacity: null,
    };
    if (facts.kind === 'race') {
      next.startsAt =
        body.startsAt === undefined ? (current?.startsAt ?? null) : dateOrNull(body.startsAt);
      next.endsAt = body.endsAt === undefined ? (current?.endsAt ?? null) : dateOrNull(body.endsAt);
      next.place = pick(body.place, current?.place ?? null);
      if (body.capacity != null) issues.push({ path: 'capacity', code: 'INVALID' });
      if (next.enabled && next.startsAt === null)
        issues.push({ path: 'startsAt', code: 'REQUIRED' });
      if (next.enabled && next.place === null) issues.push({ path: 'place', code: 'REQUIRED' });
      // RC-T3: очный старт — внутри окна гонки (проверка только при записи; правка окна позже — как есть)
      const { window } = event;
      if (
        next.startsAt !== null &&
        window !== null &&
        (next.startsAt < window.startsAt || next.startsAt >= window.closesAt)
      ) {
        issues.push({ path: 'startsAt', code: 'INVALID' });
      }
      if (next.startsAt !== null && next.endsAt !== null && next.endsAt <= next.startsAt) {
        issues.push({ path: 'endsAt', code: 'DATE_ORDER' });
      }
    } else {
      // календарь: дата, время и место — из старта (RC-T2)
      for (const field of ['startsAt', 'endsAt', 'place'] as const) {
        if (body[field] !== undefined) issues.push({ path: field, code: 'INVALID' });
      }
      next.capacity = pick(body.capacity, current?.capacity ?? null);
    }
    if (issues.length > 0) throw fieldsError(issues);
    if (next.enabled && !facts.published) throw invalidState('event_cancelled');
    if (next.enabled && !event.hasStartTime) throw invalidState('start_time_required');
    if (next.capacity !== null && next.capacity < (current?.registeredCount ?? 0)) {
      throw invalidState('capacity_below_registered');
    }
    return next;
  }

  private async settings(
    facts: EventFacts,
    doc: EventTicketingDoc | null,
  ): Promise<EventTicketingSettings> {
    const counts = await this.repository.countsOfEvent(facts.kind, facts.id);
    const race = facts.kind === 'race';
    const startsAt = race ? (doc?.startsAt ?? null) : facts.startsAt;
    const endsAt = race ? (doc?.endsAt ?? null) : facts.endsAt;
    return {
      kind: facts.kind,
      eventId: facts.id,
      enabled: doc?.enabled ?? false,
      startsAt: startsAt?.toISOString() ?? null,
      endsAt: endsAt?.toISOString() ?? null,
      place: race ? (doc?.place ?? null) : facts.place,
      address: doc?.address ?? null,
      instructions: doc?.instructions ?? null,
      capacity: doc?.capacity ?? null,
      version: doc?.version ?? 0,
      updatedAt: doc?.updatedAt.toISOString() ?? null,
      registeredCount: doc?.registeredCount ?? 0,
      activeTickets: counts.active,
      checkedIn: counts.checkedIn,
    };
  }
}
