import { Injectable } from '@nestjs/common';
import { minskToday } from '@pokatim/contracts';

import { CalendarRepository } from './calendar.repository';

/** Старт календаря для «Обзора» панели: даты — календарные Минска. */
export interface CalendarOverviewStart {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  city: string;
}

/**
 * Порт `calendar` для «Обзора» панели (admin-overview, модуль `overview`): ближайшие опубликованные старты, не
 * закончившиеся к «сегодня» по Минску (тот же отбор, что у календаря приложения). Только чтение.
 */
@Injectable()
export class CalendarOverview {
  constructor(private readonly repository: CalendarRepository) {}

  async upcoming(now: Date, limit: number): Promise<CalendarOverviewStart[]> {
    const docs = await this.repository.listPublic({ from: minskToday(now) }, null, limit);
    return docs.map((doc) => ({
      id: doc._id,
      title: doc.title,
      startsOn: doc.startsOn,
      endsOn: doc.endsOn,
      city: doc.city,
    }));
  }
}
