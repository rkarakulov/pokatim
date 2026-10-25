import { Inject, Injectable } from '@nestjs/common';
import {
  addLocalDays,
  CALENDAR_CITIES_CAP,
  type CalendarCities,
  type CalendarPage,
  type CalendarQuery,
  type CalendarStartCard,
  type CalendarStartDetail,
  LocalDate,
  minskToday,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { type CalendarStartDoc, cityKeyOf } from './calendar.collection';
import { CalendarRepository } from './calendar.repository';

/** Месяц `YYYY-MM` — первый и последний день. */
function monthDays(month: string): { first: string; last: string } {
  const next = addLocalDays(`${month}-28`, 4).slice(0, 7);
  return { first: `${month}-01`, last: addLocalDays(`${next}-01`, -1) };
}

const card = (doc: CalendarStartDoc): CalendarStartCard => ({
  id: doc._id,
  title: doc.title,
  startsOn: doc.startsOn,
  endsOn: doc.endsOn,
  startTime: doc.startTime,
  discipline: doc.discipline,
  city: doc.city,
  distancesKm: doc.distancesKm,
  registrationUrl: doc.registrationUrl,
});

/**
 * Read-модель календаря для приложения (§13, Q14): только опубликованные старты, без автора и служебных полей.
 * «Сегодня» — по Минску (`from` по умолчанию).
 */
@Injectable()
export class CalendarPublicService {
  constructor(
    private readonly repository: CalendarRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: CalendarQuery): Promise<CalendarPage> {
    const after = query.cursor ? decodeCursor(query.cursor, LocalDate) : null;
    const docs = await this.repository.listPublic(
      {
        from: query.from ?? minskToday(this.clock.now()),
        disciplines: query.discipline,
        cityKeys: query.city?.map(cityKeyOf),
        months: query.month?.map(monthDays),
      },
      after,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(card),
      nextCursor: docs.length > query.limit && last ? encodeCursor(last.startsOn, last._id) : null,
    };
  }

  async get(id: string): Promise<CalendarStartDetail> {
    const doc = await this.repository.findPublished(id);
    if (!doc) throw domainError('NOT_FOUND', 404);
    return { ...card(doc), place: doc.place, description: doc.description };
  }

  async cities(): Promise<CalendarCities> {
    return {
      cities: await this.repository.cities(minskToday(this.clock.now()), CALENDAR_CITIES_CAP),
    };
  }
}
