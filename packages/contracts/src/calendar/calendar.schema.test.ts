import { describe, expect, it } from 'vitest';

import {
  CALENDAR_START_STATUSES,
  CalendarStartInput,
  DISCIPLINES,
  PanelCalendarQuery,
  UnpublishCalendarStartRequest,
  UpdateCalendarStartRequest,
} from './calendar.schema.ts';
import { CalendarCities, CalendarQuery, CalendarStartCard } from './calendar-public.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

const start = {
  title: 'Гран-при Минска',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: '08:00',
  discipline: 'road',
  city: 'Минск',
  place: 'Парк Победы',
  distancesKm: [80, 120],
  registrationUrl: 'https://example.by/race',
  description: null,
};

describe('справочники календаря', () => {
  it('значения только в конец', () => {
    expect(DISCIPLINES).toEqual(['road', 'gravel', 'mtb']);
    expect(CALENDAR_START_STATUSES).toEqual(['published', 'unpublished']);
  });
});

describe('CalendarStartInput', () => {
  it('валидная запись; пустые место и описание — null; ссылка необязательна', () => {
    expect(CalendarStartInput.parse(start)).toEqual(start);
    expect(CalendarStartInput.parse({ ...start, place: ' ', description: '' })).toMatchObject({
      place: null,
      description: null,
    });
    expect(
      CalendarStartInput.parse({ ...start, registrationUrl: null }).registrationUrl,
    ).toBeNull();
  });

  it('ссылка: http, javascript:, с учётными данными, длинная — ошибка', () => {
    for (const registrationUrl of [
      'http://example.by',
      'javascript:alert(1)',
      'https://user:pass@example.by',
      'https://user@example.by/x',
      'https:example.by',
      'ftp://example.by',
      `https://example.by/${'a'.repeat(500)}`,
    ]) {
      expect(
        CalendarStartInput.safeParse({ ...start, registrationUrl }).success,
        registrationUrl,
      ).toBe(false);
    }
    expect(
      CalendarStartInput.safeParse({ ...start, registrationUrl: 'https://example.by/a?b=c@d' })
        .success,
    ).toBe(true);
  });

  it('дистанции 1–5 значений 1–1000; город 2–60; время HH:mm; лишний ключ', () => {
    expect(CalendarStartInput.safeParse({ ...start, distancesKm: [] }).success).toBe(false);
    expect(
      CalendarStartInput.safeParse({ ...start, distancesKm: [1, 2, 3, 4, 5, 6] }).success,
    ).toBe(false);
    expect(CalendarStartInput.safeParse({ ...start, distancesKm: [0.5] }).success).toBe(false);
    expect(CalendarStartInput.safeParse({ ...start, city: 'М' }).success).toBe(false);
    expect(CalendarStartInput.safeParse({ ...start, startTime: '8:00' }).success).toBe(false);
    expect(CalendarStartInput.safeParse({ ...start, startsOn: '2027-02-30' }).success).toBe(false);
    expect(CalendarStartInput.safeParse({ ...start, status: 'published' }).success).toBe(false);
    expect(CalendarStartInput.safeParse({ ...start, city: { $gt: '' } }).success).toBe(false);
  });

  it('изменение и снятие с публикации', () => {
    expect(UpdateCalendarStartRequest.parse({ version: 1, city: 'Гродно' })).toEqual({
      version: 1,
      city: 'Гродно',
    });
    expect(UnpublishCalendarStartRequest.safeParse({ version: 1, reason: 'ok' }).success).toBe(
      false,
    );
    expect(
      UnpublishCalendarStartRequest.parse({ version: 1, reason: 'Старт перенесён' }).reason,
    ).toBe('Старт перенесён');
  });
});

describe('запросы списка', () => {
  it('CalendarQuery: массивы из строки, границы, лишние ключи', () => {
    expect(CalendarQuery.parse({ city: 'Минск', discipline: ['road', 'mtb'] })).toEqual({
      limit: 20,
      city: ['Минск'],
      discipline: ['road', 'mtb'],
    });
    expect(CalendarQuery.safeParse({ from: '2027-02-30' }).success).toBe(false);
    expect(CalendarQuery.safeParse({ 'city[$gt]': '' }).success).toBe(false);
    expect(CalendarQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(CalendarQuery.safeParse({ city: Array.from({ length: 13 }, () => 'М') }).success).toBe(
      false,
    );
  });

  it('PanelCalendarQuery', () => {
    expect(PanelCalendarQuery.parse({ status: 'unpublished' })).toEqual({
      limit: 20,
      status: 'unpublished',
    });
    expect(PanelCalendarQuery.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});

describe('ответы приложения', () => {
  it('новая дисциплина — unknown; города', () => {
    const card = {
      id: ID,
      title: 'Гран-при',
      startsOn: '2027-06-14',
      endsOn: '2027-06-15',
      startTime: null,
      discipline: 'cyclocross',
      city: 'Минск',
      distancesKm: [100],
      registrationUrl: null,
    };
    expect(CalendarStartCard.parse(card).discipline).toBe('unknown');
    expect(CalendarCities.parse({ cities: ['Брест', 'Минск'] })).toEqual({
      cities: ['Брест', 'Минск'],
    });
  });
});
