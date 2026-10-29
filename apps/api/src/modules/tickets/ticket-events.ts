import { Inject, Injectable } from '@nestjs/common';
import {
  addLocalDays,
  minskDayStartUtc,
  minskWallTimeToUtc,
  type PanelTicketEventSummary,
  type TicketEventKind,
} from '@pokatim/contracts';

import type { DbSession } from '../../db';
import { CALENDAR_EVENTS, type CalendarEventFacts, type CalendarEvents } from '../calendar';
import { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from '../races';
import { type EventTicketingDoc, ticketingIdOf } from './tickets.collection';
import type { EventFacts } from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

/** Ссылка на событие билета. */
export interface EventRef {
  kind: TicketEventKind;
  id: string;
}

const refKey = (ref: EventRef) => ticketingIdOf(ref.kind, ref.id);

/**
 * Момент старта календаря (RC-T2): дата + время Минска; без времени — начало дня (консервативно: регистрация
 * закрывается не позже дня старта). Конец — конец дня `endsOn` по Минску или `null`.
 */
export function calendarMoments(
  start: Pick<CalendarEventFacts, 'startsOn' | 'endsOn' | 'startTime'>,
): {
  startsAt: Date;
  endsAt: Date | null;
} {
  return {
    startsAt: start.startTime
      ? new Date(minskWallTimeToUtc(`${start.startsOn}T${start.startTime}`))
      : minskDayStartUtc(start.startsOn),
    endsAt: start.endsOn ? minskDayStartUtc(addLocalDays(start.endsOn, 1)) : null,
  };
}

function raceFacts(race: RaceForResults, ticketing: EventTicketingDoc | null): EventFacts {
  const published = race.status !== 'cancelled';
  return {
    kind: 'race',
    id: race.id,
    title: race.title,
    state: published && ticketing?.enabled === true ? 'scheduled' : 'cancelled',
    published,
    startsAt: ticketing?.startsAt ?? race.windowStartsAt,
    endsAt: ticketing?.endsAt ?? null,
    place: ticketing?.place ?? null,
    address: ticketing?.address ?? null,
    city: null,
    distancesKm: [],
    windowClosesAt: race.closesAt,
    ownerUserId: race.ownerUserId,
    ticketing,
  };
}

function calendarFacts(start: CalendarEventFacts, ticketing: EventTicketingDoc | null): EventFacts {
  const published = start.status === 'published';
  return {
    kind: 'calendar',
    id: start.id,
    title: start.title,
    state: published && ticketing?.enabled === true ? 'scheduled' : 'cancelled',
    published,
    ...calendarMoments(start),
    place: start.place,
    address: ticketing?.address ?? null,
    city: start.city,
    distancesKm: start.distancesKm,
    windowClosesAt: null,
    ownerUserId: null,
    ticketing,
  };
}

/** Событие в ответе (приложение и панель). */
export const eventSummary = (event: EventFacts): PanelTicketEventSummary => ({
  kind: event.kind,
  id: event.id,
  title: event.title,
  startsAt: event.startsAt.toISOString(),
  endsAt: event.endsAt?.toISOString() ?? null,
  place: event.place,
  address: event.address,
  city: event.city,
});

/**
 * Факты событий билетов из портов `races` (`RaceRegistry`: только `published`/`cancelled`) и `calendar`
 * (`CalendarEvents`) и настроек билетов. Даты календаря не денормализуются (RC-T2): правка старта сразу видна в билете.
 */
@Injectable()
export class TicketEvents {
  constructor(
    private readonly repository: TicketsRepository,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(CALENDAR_EVENTS) private readonly calendar: CalendarEvents,
  ) {}

  /** Событие; нет (неизвестно, черновик гонки) — `null`. */
  async resolve(kind: TicketEventKind, id: string): Promise<EventFacts | null> {
    return (await this.resolveMany([{ kind, id }])).get(refKey({ kind, id })) ?? null;
  }

  /** Пачкой: ключ — `"<kind>:<id>"`. */
  async resolveMany(refs: readonly EventRef[]): Promise<Map<string, EventFacts>> {
    const raceIds = refs.filter((ref) => ref.kind === 'race').map((ref) => ref.id);
    const calendarIds = refs.filter((ref) => ref.kind === 'calendar').map((ref) => ref.id);
    const [races, starts, ticketings] = await Promise.all([
      raceIds.length > 0 ? this.races.getMany(raceIds) : new Map<string, RaceForResults>(),
      calendarIds.length > 0
        ? this.calendar.getMany(calendarIds)
        : new Map<string, CalendarEventFacts>(),
      this.repository.findTicketings(refs.map(refKey)),
    ]);
    const settings = new Map(ticketings.map((doc) => [doc._id, doc] as const));
    const result = new Map<string, EventFacts>();
    for (const race of races.values()) {
      const key = ticketingIdOf('race', race.id);
      result.set(key, raceFacts(race, settings.get(key) ?? null));
    }
    for (const start of starts.values()) {
      const key = ticketingIdOf('calendar', start.id);
      result.set(key, calendarFacts(start, settings.get(key) ?? null));
    }
    return result;
  }

  /** Гонка (для проверок окна в настройках); не опубликована и не отменена — `null`. */
  race(id: string): Promise<RaceForResults | null> {
    return this.races.get(id);
  }

  /**
   * Захват гонки в транзакции check-in (`RaceRegistry.lockResults` — запись в документ гонки): отмена гонки
   * конфликтует с отметкой. Черновик или нет — `null`.
   */
  lockRace(tx: DbSession, id: string): Promise<RaceForResults | null> {
    return this.races.lockResults(tx, id);
  }

  /** Захват и чтение старта календаря в транзакции регистрации и check-in (порт `CALENDAR_EVENTS`). */
  lockCalendarStart(tx: DbSession, id: string): Promise<CalendarEventFacts | null> {
    return this.calendar.lockForAdmission(tx, id);
  }

  /** Старт календаря (любой статус); нет — `null`. */
  calendarStart(id: string): Promise<CalendarEventFacts | null> {
    return this.calendar.get(id);
  }
}
