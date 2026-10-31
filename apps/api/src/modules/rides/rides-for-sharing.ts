import { Inject, Injectable } from '@nestjs/common';
import type { LonLat } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import type { ChangedCursor, ChangedRow } from '../../changed-since';
import { domainError } from '../../error-messages';
import { RIDE_ROUTES, type RideRoutes } from '../routes';
import type { RideInviteFacts, RidesForSharing } from './rides-for-sharing.port';
import { ridePhase } from './rides.policy';
import type { RideDoc } from './rides.collection';
import { RidePhotosRepository } from './ride-photos.repository';
import { RidesRepository } from './rides.repository';

type RideFactsDoc = Pick<
  RideDoc,
  | '_id'
  | 'title'
  | 'startsAt'
  | 'place'
  | 'distanceKm'
  | 'paceMinKmh'
  | 'paceMaxKmh'
  | 'routeId'
  | 'photoId'
>;

/**
 * Реализация порта `RidesForSharing` (карточка-приглашение): скрытый — 404 всем, включая организатора (картинка
 * уходит наружу); карточка — только у будущего опубликованного райда; OG-картинка (og-images) — у любого
 * опубликованного (скрытый, отменённый — `null`). Маршрут — только видимый гостю (`visible(…, null)` → `public`), без
 * кэша.
 */
@Injectable()
export class RidesForSharingService implements RidesForSharing {
  constructor(
    private readonly repository: RidesRepository,
    private readonly photos: RidePhotosRepository,
    @Inject(RIDE_ROUTES) private readonly routes: RideRoutes,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async inviteFacts(userId: string, rideId: string): Promise<RideInviteFacts | null> {
    const doc = await this.repository.findForViewer(rideId, userId);
    if (!doc || doc.status === 'hidden') throw domainError('NOT_FOUND', 404);
    if (ridePhase(doc, this.clock.now()) !== 'upcoming') return null;
    return this.factsOf(doc);
  }

  async ogFacts(rideId: string): Promise<RideInviteFacts | null> {
    const doc = await this.repository.findPublic(rideId);
    if (!doc || doc.status !== 'published') return null;
    return this.factsOf(doc);
  }

  ogChanged(after: ChangedCursor | null, limit: number): Promise<ChangedRow[]> {
    return this.repository.changedForOg(after, limit);
  }

  /** Публичные поля карточки; маршрут — только видимый гостю (`public`, в каталоге сейчас). */
  private async factsOf(doc: RideFactsDoc): Promise<RideInviteFacts> {
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
      photoId: doc.photoId ?? null,
    };
  }

  async invitePhoto(rideId: string, photoId: string): Promise<Uint8Array | null> {
    const doc = await this.photos.findBytes(photoId);
    if (!doc || doc.rideId !== rideId) return null;
    if (!(await this.repository.isCurrentPhoto(rideId, photoId))) return null;
    return doc.bytes.buffer;
  }

  inviteLine(routeId: string): Promise<LonLat[] | null> {
    return this.routes.catalogLine(routeId);
  }
}
