import { Inject, Injectable } from '@nestjs/common';
import type { LonLat } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { RIDE_ROUTES, type RideRoutes } from '../routes';
import type { RideInviteFacts, RidesForSharing } from './rides-for-sharing.port';
import { ridePhase } from './rides.policy';
import { RidesRepository } from './rides.repository';

/**
 * Реализация порта `RidesForSharing` (карточка-приглашение): скрытый — 404 всем, включая организатора (картинка
 * уходит наружу); карточка — только у будущего опубликованного райда. Маршрут — только видимый гостю (`visible(…,
 * null)` → `public`), без кэша.
 */
@Injectable()
export class RidesForSharingService implements RidesForSharing {
  constructor(
    private readonly repository: RidesRepository,
    @Inject(RIDE_ROUTES) private readonly routes: RideRoutes,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async inviteFacts(userId: string, rideId: string): Promise<RideInviteFacts | null> {
    const doc = await this.repository.findForViewer(rideId, userId);
    if (!doc || doc.status === 'hidden') throw domainError('NOT_FOUND', 404);
    if (ridePhase(doc, this.clock.now()) !== 'upcoming') return null;
    const routeId = doc.routeId ?? null;
    const visible = routeId ? await this.routes.visible([routeId], null) : null;
    return {
      rideId: doc._id,
      title: doc.title,
      startsAt: doc.startsAt,
      place: doc.place,
      distanceKm: doc.distanceKm,
      paceMinKmh: doc.paceMinKmh,
      paceMaxKmh: doc.paceMaxKmh,
      routeId: routeId && visible?.get(routeId)?.access === 'public' ? routeId : null,
    };
  }

  inviteLine(routeId: string): Promise<LonLat[] | null> {
    return this.routes.catalogLine(routeId);
  }
}
