import {
  CalendarCity,
  CalendarDistances,
  type CalendarStartInput,
  Discipline,
  LocalDate,
  LocalTime,
  type PanelCalendarStart,
  RaceTitle,
  RegistrationUrl,
} from '@pokatim/contracts';
import { z } from 'zod';

/** Пустое поле ввода — `null`, иначе — схема контракта. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.union([z.literal('').transform(() => null), schema]);

/**
 * Значения формы записи календаря: поля — схемы контракта; дистанции — строка «80, 120» (запятая или пробел),
 * необязательные поля — пустая строка в форме, `null` в запросе.
 */
export const CalendarFormSchema = z.object({
  title: RaceTitle,
  startsOn: LocalDate,
  endsOn: optional(LocalDate),
  startTime: optional(LocalTime),
  discipline: Discipline,
  city: CalendarCity,
  place: z.string(),
  distancesKm: z
    .string()
    .transform((value) =>
      // «80, 120» и «80 120» — две дистанции; «42,2» — десятичная запятая
      value
        .replace(/,\s+/g, ' ')
        .split(/[;\s]+/)
        .filter(Boolean)
        .map((item) => Number(item.replace(',', '.'))),
    )
    .pipe(CalendarDistances),
  registrationUrl: optional(RegistrationUrl),
  description: z.string(),
});
export type CalendarFormValues = z.input<typeof CalendarFormSchema>;
export type CalendarFormOutput = z.output<typeof CalendarFormSchema>;

export const emptyCalendarForm = (): CalendarFormValues => ({
  title: '',
  startsOn: '',
  endsOn: '',
  startTime: '',
  discipline: 'road',
  city: '',
  place: '',
  distancesKm: '',
  registrationUrl: '',
  description: '',
});

export function calendarFormOf(start: PanelCalendarStart): CalendarFormValues {
  return {
    title: start.title,
    startsOn: start.startsOn,
    endsOn: start.endsOn ?? '',
    startTime: start.startTime ?? '',
    discipline: start.discipline,
    city: start.city,
    place: start.place ?? '',
    distancesKm: start.distancesKm.join(', '),
    registrationUrl: start.registrationUrl ?? '',
    description: start.description ?? '',
  };
}

export function calendarInputOf(values: CalendarFormOutput): CalendarStartInput {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    ...values,
    place: text(values.place),
    description: text(values.description),
  };
}
