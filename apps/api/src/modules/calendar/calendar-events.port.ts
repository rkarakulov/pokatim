import type { CalendarStartStatus } from '@pokatim/contracts';

/**
 * Порт `calendar` для модуля `tickets` (event-tickets, через `modules/calendar/index.ts`): факты старта для
 * регистрации и билетов — даты Минска, время, место, дистанции, статус публикации. `tickets` коллекцию
 * `calendar_starts` не читает; `calendar` о билетах не знает (момент старта вычисляет `tickets`, RC-T2).
 */
export const CALENDAR_EVENTS = Symbol('CALENDAR_EVENTS');

export interface CalendarEventFacts {
  id: string;
  status: CalendarStartStatus;
  title: string;
  /** календарная дата Минска `YYYY-MM-DD` */
  startsOn: string;
  endsOn: string | null;
  /** `HH:mm` Минска или `null` */
  startTime: string | null;
  city: string;
  place: string | null;
  distancesKm: number[];
}

export interface CalendarEvents {
  /** Старт по id (любой статус); нет — `null`. */
  get(id: string): Promise<CalendarEventFacts | null>;
  /** Пачкой; незнакомых в карте нет. */
  getMany(ids: readonly string[]): Promise<Map<string, CalendarEventFacts>>;
}
