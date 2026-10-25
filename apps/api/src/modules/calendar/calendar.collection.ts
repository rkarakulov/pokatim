import type { CalendarStartStatus, Discipline } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Календарь стартов (ADR-0010): внешние массовые старты с регистрацией у организатора. Создаёт миграция
 * `0008_calendar`; единственный писатель — `CalendarRepository`.
 */
export const CALENDAR_COLLECTIONS = { starts: 'calendar_starts' } as const;

/**
 * Старт: даты — календарные Минска (`LocalDate`), время старта — `HH:mm` Минска или `null`. `cityKey` — город в
 * нижнем регистре со схлопнутыми пробелами (фильтр без учёта регистра и уникальный список городов).
 */
export interface CalendarStartDoc {
  _id: string;
  status: CalendarStartStatus;
  title: string;
  startsOn: string;
  endsOn: string | null;
  startTime: string | null;
  discipline: Discipline;
  city: string;
  cityKey: string;
  place: string | null;
  distancesKm: number[];
  registrationUrl: string | null;
  description: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  unpublishedAt: Date | null;
  version: number;
}

export function calendarCollections(db: Db): { starts: Collection<CalendarStartDoc> } {
  return { starts: db.collection<CalendarStartDoc>(CALENDAR_COLLECTIONS.starts) };
}

/** Ключ города: нижний регистр, пробелы схлопнуты. */
export function cityKeyOf(city: string): string {
  return city.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
}
