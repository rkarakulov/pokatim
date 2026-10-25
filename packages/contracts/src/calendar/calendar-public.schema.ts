import { z } from 'zod';

import { PageQuery, queryArray, tolerantEnum, Uuid } from '../common.ts';
import { PageCursor } from '../races/race.schema.ts';
import { LocalDate, LocalTime, YearMonth } from '../time.ts';
import { CALENDAR_CITY_MAX_LENGTH, Discipline, DISCIPLINES } from './calendar.schema.ts';

export const CALENDAR_LIST_MAX_LIMIT = 50;
export const CALENDAR_CITIES_CAP = 200;

/**
 * `GET /v1/calendar?from&discipline&city&month&cursor&limit` → `CalendarPage` (публично, только опубликованные).
 * `from` по умолчанию — сегодня по Минску (`endsOn ?? startsOn ≥ from`); город — без учёта регистра.
 */
export const CalendarQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(CALENDAR_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
  from: LocalDate.optional(),
  discipline: queryArray(Discipline, DISCIPLINES.length).optional(),
  city: queryArray(z.string().max(CALENDAR_CITY_MAX_LENGTH), 12).optional(),
  month: queryArray(YearMonth, 12).optional(),
});
export type CalendarQuery = z.infer<typeof CalendarQuery>;

/** Старт в списке приложения; `registrationUrl` нет — кнопки регистрации нет. */
export const CalendarStartCard = z.object({
  id: Uuid,
  title: z.string(),
  startsOn: LocalDate,
  endsOn: LocalDate.nullable(),
  startTime: LocalTime.nullable(),
  discipline: tolerantEnum(DISCIPLINES),
  city: z.string(),
  distancesKm: z.array(z.number()),
  registrationUrl: z.string().nullable(),
});
export type CalendarStartCard = z.infer<typeof CalendarStartCard>;

/** `GET /v1/calendar/:id` — опубликованный старт; снятый и неизвестный — 404. */
export const CalendarStartDetail = CalendarStartCard.extend({
  place: z.string().nullable(),
  description: z.string().nullable(),
});
export type CalendarStartDetail = z.infer<typeof CalendarStartDetail>;

export const CalendarPage = z.object({
  items: z.array(CalendarStartCard),
  nextCursor: z.string().nullable(),
});
export type CalendarPage = z.infer<typeof CalendarPage>;

/** `GET /v1/calendar/cities` — города будущих опубликованных стартов, по алфавиту, ≤ 200. */
export const CalendarCities = z.object({ cities: z.array(z.string()) });
export type CalendarCities = z.infer<typeof CalendarCities>;
