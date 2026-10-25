import { z } from 'zod';

import { fieldError, MULTI_LINE, PageQuery, SINGLE_LINE, Uuid, Version } from '../common.ts';
import { ActionReason } from '../admin/members.schema.ts';
import { PageCursor, RaceTitle } from '../races/race.schema.ts';
import { LocalDate, LocalTime } from '../time.ts';

/*
 * Календарь стартов (ADR-0010): внешние массовые старты с регистрацией у организатора — без окна, протокола и
 * сезона. Ведёт команда платформы (`calendar.manage`), запись публикуется сразу.
 */

/** Дисциплины календаря (Q10); только в конец — приложение разбирает `tolerantEnum`. */
export const DISCIPLINES = ['road', 'gravel', 'mtb'] as const;
export const Discipline = z.enum(DISCIPLINES, { error: fieldError('INVALID') });
export type Discipline = z.infer<typeof Discipline>;

export const CALENDAR_START_STATUSES = ['published', 'unpublished'] as const;
export const CalendarStartStatus = z.enum(CALENDAR_START_STATUSES);
export type CalendarStartStatus = z.infer<typeof CalendarStartStatus>;

export const CALENDAR_CITY_MAX_LENGTH = 60;
export const CALENDAR_PLACE_MAX_LENGTH = 200;
export const CALENDAR_DESCRIPTION_MAX_LENGTH = 4000;
export const CALENDAR_URL_MAX_LENGTH = 500;
export const CALENDAR_DISTANCES_MAX = 5;

/** Необязательный текст: пустой после обрезки — `null`. */
const optionalText = (max: number, pattern: RegExp) =>
  z
    .string({ error: fieldError('INVALID') })
    .trim()
    .max(max, { error: 'TOO_LONG' })
    .regex(new RegExp(`${pattern.source}|^$`, pattern.flags), { error: 'INVALID' })
    .transform((value) => (value === '' ? null : value))
    .nullable();

export const CalendarCity = z
  .string({ error: fieldError('REQUIRED') })
  .trim()
  .min(1, { error: 'REQUIRED', abort: true })
  .min(2, { error: 'TOO_SHORT', abort: true })
  .max(CALENDAR_CITY_MAX_LENGTH, { error: 'TOO_LONG' })
  .regex(SINGLE_LINE, { error: 'INVALID' });

/**
 * Ссылка на регистрацию у организатора (Q12 — необязательна): только `https://`, без учётных данных, ≤ 500.
 * Открывается в новой вкладке с `rel="noopener noreferrer"`.
 */
export const RegistrationUrl = z
  .string({ error: fieldError('INVALID') })
  .trim()
  .max(CALENDAR_URL_MAX_LENGTH, { error: 'TOO_LONG', abort: true })
  .pipe(
    z
      .url({ protocol: /^https$/, error: 'INVALID' })
      .refine((value) => /^https:\/\//i.test(value), { error: 'INVALID' })
      // учётные данные в authority (`https://user:pass@host`) — нет
      .refine((value) => !/^https:\/\/[^/?#]*@/i.test(value), { error: 'INVALID' }),
  );

export const CalendarDistances = z
  .array(
    z
      .number({ error: fieldError('INVALID') })
      .min(1, { error: 'INVALID' })
      .max(1000, { error: 'INVALID' })
      .multipleOf(0.1, { error: 'INVALID' }),
    { error: fieldError('REQUIRED') },
  )
  .min(1, { error: 'REQUIRED' })
  .max(CALENDAR_DISTANCES_MAX, { error: 'INVALID' });

/**
 * `POST /v1/admin/calendar` (`calendar.manage`) → 201 `PanelCalendarStart` (сразу `published`). Конец — `null` для
 * однодневного; порядок дат и длительность — правила сервера (`DATE_ORDER`).
 */
export const CalendarStartInput = z.strictObject({
  title: RaceTitle,
  startsOn: LocalDate,
  endsOn: LocalDate.nullable(),
  startTime: LocalTime.nullable(),
  discipline: Discipline,
  city: CalendarCity,
  place: optionalText(CALENDAR_PLACE_MAX_LENGTH, SINGLE_LINE),
  distancesKm: CalendarDistances,
  registrationUrl: RegistrationUrl.nullable(),
  description: optionalText(CALENDAR_DESCRIPTION_MAX_LENGTH, MULTI_LINE),
});
export type CalendarStartInput = z.infer<typeof CalendarStartInput>;

/** `POST /v1/admin/calendar/:id` — изменённые поля + ожидаемая `version`. */
export const UpdateCalendarStartRequest = CalendarStartInput.partial().extend({ version: Version });
export type UpdateCalendarStartRequest = z.infer<typeof UpdateCalendarStartRequest>;

/** `POST /v1/admin/calendar/:id/unpublish` — причина уходит в журнал. */
export const UnpublishCalendarStartRequest = z.strictObject({
  version: Version,
  reason: ActionReason,
});
export type UnpublishCalendarStartRequest = z.infer<typeof UnpublishCalendarStartRequest>;

/** `POST /v1/admin/calendar/:id/republish` — «Вернуть в календарь». */
export const RepublishCalendarStartRequest = z.strictObject({ version: Version });
export type RepublishCalendarStartRequest = z.infer<typeof RepublishCalendarStartRequest>;

/** Запись календаря в панели (ответ — форма данных, правила ввода не повторяются). */
export const PanelCalendarStart = z.object({
  id: Uuid,
  status: CalendarStartStatus,
  title: z.string(),
  startsOn: LocalDate,
  endsOn: LocalDate.nullable(),
  startTime: LocalTime.nullable(),
  discipline: Discipline,
  city: z.string(),
  place: z.string().nullable(),
  distancesKm: z.array(z.number()),
  registrationUrl: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: Version,
});
export type PanelCalendarStart = z.infer<typeof PanelCalendarStart>;

/** `GET /v1/admin/calendar` — все записи (и прошедшие), новые даты сверху, курсор. */
export const PanelCalendarQuery = z.strictObject({
  ...PageQuery.shape,
  cursor: PageCursor.optional(),
  status: CalendarStartStatus.optional(),
  discipline: Discipline.optional(),
});
export type PanelCalendarQuery = z.infer<typeof PanelCalendarQuery>;

export const PanelCalendarPage = z.object({
  items: z.array(PanelCalendarStart),
  nextCursor: z.string().nullable(),
});
export type PanelCalendarPage = z.infer<typeof PanelCalendarPage>;
