import { Injectable } from '@nestjs/common';
import type { TicketEventKind } from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import type { PanelPrincipal } from '../panel';
import { TicketEvents } from './ticket-events';
import { type EventFacts, eventAccess } from './tickets.policy';

/** Событие панели: факты + доступ проверен. */
export interface PanelEvent {
  facts: EventFacts;
  /** окно гонки (проверка очного старта, RC-T3); календарь — `null` */
  window: { startsAt: Date; closesAt: Date } | null;
  /** время старта календаря задано (RC-T2) */
  hasStartTime: boolean;
}

/**
 * Событие билетов в панели с проверкой доступа (RC-T9) — одна проверка для настроек, участников и материалов (PR C):
 * нет права по виду события — 403 до чтения (не выдаёт существование), нет или чужое — 404. Гонка — только
 * `published|cancelled` (`RACE_REGISTRY`).
 */
@Injectable()
export class PanelEvents {
  constructor(private readonly events: TicketEvents) {}

  async resolve(
    principal: PanelPrincipal,
    kind: TicketEventKind,
    eventId: string,
    purpose: 'manage' | 'checkin',
  ): Promise<PanelEvent> {
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
}
