import { Inject, Injectable } from '@nestjs/common';
import type { EventTicketingPublic, TicketEventKind } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { TicketEvents } from './ticket-events';
import { registrationGate } from './tickets.policy';

/**
 * Публичная сводка регистрации события (RC-T7, без входа): билеты не включены, события нет или оно не опубликовано —
 * `{ enabled: false }` (статус события отдают `races`/`calendar`). Без счётчиков билетов и владельца.
 */
@Injectable()
export class TicketingPublicService {
  constructor(
    private readonly events: TicketEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(kind: TicketEventKind, eventId: string): Promise<EventTicketingPublic> {
    const event = await this.events.resolve(kind, eventId);
    if (!event || event.state !== 'scheduled' || !event.ticketing) return { enabled: false };
    const { capacity, registeredCount } = event.ticketing;
    const calendar = kind === 'calendar';
    return {
      enabled: true,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      place: event.place,
      address: event.address,
      capacity: calendar ? capacity : null,
      seatsLeft: calendar && capacity !== null ? Math.max(0, capacity - registeredCount) : null,
      registrationOpen:
        calendar &&
        registrationGate(event, this.clock.now()) === null &&
        (capacity === null || registeredCount < capacity),
      distancesKm: event.distancesKm,
    };
  }
}
