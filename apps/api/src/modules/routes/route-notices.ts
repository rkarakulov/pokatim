import { Injectable } from '@nestjs/common';

import type { RouteNotices, RoutePublicationNotice } from './route-notices.port';
import { RoutesRepository } from './routes.repository';

/** Реализация порта `RouteNotices` (notifications): проекция `RoutesRepository.findForNotice`. */
@Injectable()
export class RouteNoticesService implements RouteNotices {
  constructor(private readonly routes: RoutesRepository) {}

  async publication(routeId: string): Promise<RoutePublicationNotice | null> {
    const doc = await this.routes.findForNotice(routeId);
    if (!doc?.publication) return null;
    return {
      id: doc._id,
      title: doc.title,
      ownerUserId: doc.ownerUserId,
      status: doc.publication.status,
      decidedAt: doc.publication.decidedAt,
      rejectionReason: doc.publication.rejection?.reason ?? null,
    };
  }
}
