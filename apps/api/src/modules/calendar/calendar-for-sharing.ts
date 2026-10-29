import { Injectable } from '@nestjs/common';

import type { ChangedCursor, ChangedRow } from '../../changed-since';
import type { CalendarForSharing, CalendarOgFacts } from './calendar-for-sharing.port';
import { CalendarRepository } from './calendar.repository';

/** Реализация порта `CalendarForSharing` (OG-картинка): только `published`, как публичная карточка. */
@Injectable()
export class CalendarForSharingService implements CalendarForSharing {
  constructor(private readonly repository: CalendarRepository) {}

  async ogFacts(startId: string): Promise<CalendarOgFacts | null> {
    const start = await this.repository.findPublished(startId);
    if (!start) return null;
    return {
      startId: start._id,
      title: start.title,
      startsOn: start.startsOn,
      endsOn: start.endsOn,
      city: start.city,
      distancesKm: [...start.distancesKm],
    };
  }

  ogChanged(after: ChangedCursor | null, limit: number): Promise<ChangedRow[]> {
    return this.repository.changedForOg(after, limit);
  }
}
