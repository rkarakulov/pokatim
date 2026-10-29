import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CheckInOutcome, CheckInRequest, CheckInView } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { PanelAudit, PanelDirectory, type PanelPrincipal } from '../panel';
import { ParticipantNames } from './participant-names';
import { RaceTickets } from './race-tickets';
import { eventSummary, TicketEvents } from './ticket-events';
import { parseQrPayload, qrHashOf } from './ticket-qr';
import { categoryView } from './ticket-views';
import type { TicketDoc } from './tickets.collection';
import {
  checkInWindow,
  type EventFacts,
  eventAccess,
  TICKETS_POLICY,
  ticketStatus,
} from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

/** Бизнес-исход проверки без отметки. */
function outcomeOf(doc: TicketDoc, event: EventFacts, now: Date): CheckInOutcome {
  const status = ticketStatus(doc, event);
  if (status === 'cancelled') return 'cancelled';
  if (status === 'checked_in') return 'already_checked_in';
  if (status === 'event_cancelled') return 'event_cancelled';
  const { opensAt, closesAt } = checkInWindow(event);
  if (now < opensAt || now >= closesAt) return 'outside_window';
  return 'ready';
}

/**
 * Check-in участника в панели (`tickets.checkin`, event-tickets): лимит `tickets-checkin:<сессия>` 120/мин → билет по
 * хэшу QR или коду → событие и доступ (`eventAccess`; чужое — тот же 404, что «нет билета») → исход. Отметка —
 * транзакция: условный переход `active → checked_in` + журнал `tickets.checked_in` (код, без имени и e-mail);
 * проигравший параллельный скан — `already_checked_in`.
 */
@Injectable()
export class CheckInService {
  private readonly logger = new Logger(CheckInService.name);

  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
    private readonly raceTickets: RaceTickets,
    private readonly names: ParticipantNames,
    private readonly directory: PanelDirectory,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  lookup(principal: PanelPrincipal, body: CheckInRequest): Promise<CheckInView> {
    return this.handle(principal, body, false);
  }

  checkIn(principal: PanelPrincipal, body: CheckInRequest): Promise<CheckInView> {
    return this.handle(principal, body, true);
  }

  private async handle(
    principal: PanelPrincipal,
    body: CheckInRequest,
    mark: boolean,
  ): Promise<CheckInView> {
    const now = this.clock.now();
    await consumeUserLimit(
      this.rateLimiter,
      `tickets-checkin:${principal.sessionId}`,
      TICKETS_POLICY.checkInLimit,
      now,
    );
    const found = await this.find(body);
    if (!found) throw domainError('NOT_FOUND', 404);
    const event = await this.events.resolve(found.kind, found.eventId);
    if (!event || eventAccess(principal, event.kind, 'checkin', event.ownerUserId) !== 'ok') {
      throw domainError('NOT_FOUND', 404);
    }
    let doc = await this.raceTickets.refresh(found);
    let outcome = outcomeOf(doc, event, now);
    if (mark && outcome === 'ready') {
      const marked = await this.transactions.run(async (tx) => {
        const updated = await this.repository.markCheckedIn(tx, doc._id, principal.userId, now);
        if (!updated) return null;
        await this.audit.append(tx, {
          action: 'tickets.checked_in',
          actor: { kind: 'user', userId: principal.userId },
          subject: {
            kind: event.kind === 'race' ? 'race' : 'calendar_start',
            id: event.id,
            label: event.title,
          },
          details: { ticketCode: doc.code },
        });
        return updated;
      });
      if (marked) {
        doc = marked;
        outcome = 'checked_in';
        this.logger.log(`tickets.checked_in ticket=${doc._id} event=${event.id}`);
      } else {
        doc = (await this.repository.findTicket(doc._id)) ?? doc;
        outcome = outcomeOf(doc, event, now);
      }
    }
    return this.view(outcome, doc, event);
  }

  private find(body: CheckInRequest): Promise<TicketDoc | undefined> {
    if ('qr' in body) {
      const token = parseQrPayload(body.qr);
      return token ? this.repository.findByQrHash(qrHashOf(token)) : Promise.resolve(undefined);
    }
    return this.repository.findByCode(body.code);
  }

  private async view(
    outcome: CheckInOutcome,
    doc: TicketDoc,
    event: EventFacts,
  ): Promise<CheckInView> {
    const [names, staff] = await Promise.all([
      this.names.of([doc.userId]),
      doc.checkedInBy ? this.directory.displayNames([doc.checkedInBy]) : new Map<string, string>(),
    ]);
    return {
      outcome,
      ticket: {
        code: doc.code,
        status: ticketStatus(doc, event),
        participantName: names.get(doc.userId) ?? TICKETS_POLICY.anonymousName,
        category: categoryView(doc.category),
        event: eventSummary(event),
        checkedInAt: doc.checkedInAt?.toISOString() ?? null,
        checkedInBy: doc.checkedInBy ? (staff.get(doc.checkedInBy) ?? null) : null,
      },
    };
  }
}
