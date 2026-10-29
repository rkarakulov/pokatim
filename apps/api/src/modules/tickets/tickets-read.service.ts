import { Inject, Injectable } from '@nestjs/common';
import type { MyTicketRef, MyTickets, TicketView } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, RateLimiter } from '@rkarakulov/api-kit/core';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { RIDER_NAMES, type RiderNameDirectory } from '../profile';
import { MaterialsRead } from './materials-read';
import { RaceTickets } from './race-tickets';
import { TicketEvents } from './ticket-events';
import { qrPayload, ticketQrToken } from './ticket-qr';
import { categoryView, ticketRef } from './ticket-views';
import { ticketingIdOf } from './tickets.collection';
import { TICKETS_POLICY } from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

const startsAtOf = (ref: MyTicketRef) => Date.parse(ref.event.startsAt);

/**
 * Чтение своих билетов (event-tickets): только владелец (`userId` сессии в фильтре), чужой и несуществующий код —
 * один 404. QR — только у активного билета непрошедшего события; токен пересчитывается из id (в БД — только хэш).
 * Имя участника — профиль (`RIDER_NAMES.attributionNames`, служебный показ без согласия), нет — «Участник».
 */
@Injectable()
export class TicketsReadService {
  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
    private readonly raceTickets: RaceTickets,
    private readonly materials: MaterialsRead,
    private readonly rateLimiter: RateLimiter,
    @Inject(RIDER_NAMES) private readonly names: RiderNameDirectory,
    @Inject(ENV) private readonly env: Pick<Env, 'EMAIL_TOKEN_SECRET'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Предстоящие (без отменённых райдером, по дате ↑, ≤ 50) и прошедшие (по дате ↓, ≤ 20), RC-T8. */
  async list(userId: string): Promise<MyTickets> {
    const now = this.clock.now();
    await this.limit(userId, now);
    const docs = await this.repository.ticketsOfUser(userId, TICKETS_POLICY.listFetchMax);
    const events = await this.events.resolveMany(
      docs.map((doc) => ({ kind: doc.kind, id: doc.eventId })),
    );
    const refs = docs.flatMap((doc) => {
      const event = events.get(ticketingIdOf(doc.kind, doc.eventId));
      return event ? [ticketRef(doc, event, now)] : [];
    });
    return {
      upcoming: refs
        .filter((ref) => !ref.past && ref.status !== 'cancelled')
        .sort((a, b) => startsAtOf(a) - startsAtOf(b))
        .slice(0, TICKETS_POLICY.listMax),
      past: refs
        .filter((ref) => ref.past)
        .sort((a, b) => startsAtOf(b) - startsAtOf(a))
        .slice(0, TICKETS_POLICY.pastMax),
    };
  }

  async view(userId: string, code: string): Promise<TicketView> {
    const now = this.clock.now();
    await this.limit(userId, now);
    const found = await this.repository.findOwnByCode(userId, code);
    if (!found) throw domainError('NOT_FOUND', 404);
    const event = await this.events.resolve(found.kind, found.eventId);
    if (!event) throw domainError('NOT_FOUND', 404);
    const doc = await this.raceTickets.refresh(found);
    const ref = ticketRef(doc, event, now);
    const name = (await this.names.attributionNames([userId])).get(userId);
    return {
      ...ref,
      participantName: name ?? TICKETS_POLICY.anonymousName,
      category: categoryView(doc.category),
      qr:
        ref.status === 'active' && !ref.past
          ? qrPayload(ticketQrToken(this.env.EMAIL_TOKEN_SECRET, doc._id))
          : null,
      instructions: event.ticketing?.instructions ?? null,
      checkedInAt: doc.checkedInAt?.toISOString() ?? null,
      materials: await this.materials.of(doc.kind, doc.eventId),
    };
  }

  private limit(userId: string, now: Date): Promise<void> {
    return consumeUserLimit(
      this.rateLimiter,
      `tickets-read:${userId}`,
      TICKETS_POLICY.readLimit,
      now,
    );
  }
}
