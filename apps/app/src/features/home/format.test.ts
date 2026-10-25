/// <reference types="jest" />
import type { CalendarStartCard } from '@pokatim/contracts';

import {
  calendarMeta,
  calendarStatusLine,
  daysUntilStart,
  formatCalendarStartDate,
} from './format';

const start = (overrides: Partial<CalendarStartCard> = {}): CalendarStartCard => ({
  id: '0190a6f4-0000-7000-8000-000000000002',
  title: 'Минская сотка',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: null,
  discipline: 'road',
  city: 'Минск',
  distancesKm: [100],
  registrationUrl: null,
  phase: 'upcoming',
  ...overrides,
});

/** «Сейчас» по UTC: 2026-10-01 12:00 UTC = 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');

// перевод времени — только по Минску: пояс процесса (устройства) не должен влиять (§4.7)
describe.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('подписи Главной в TZ=%s', (tz) => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  describe('календарь', () => {
    it('дата старта: текущий год — без года, иначе с годом; многодневный — диапазон', () => {
      expect(formatCalendarStartDate(start({ startsOn: '2026-10-14' }), NOW)).toEqual({
        value: '14',
        unit: 'октября',
      });
      expect(formatCalendarStartDate(start(), NOW)).toEqual({ value: '14', unit: 'июня 2027' });
      expect(
        formatCalendarStartDate(start({ startsOn: '2026-06-26', endsOn: '2026-06-27' }), NOW),
      ).toEqual({ value: '26–27', unit: 'июня' });
      expect(
        formatCalendarStartDate(start({ startsOn: '2026-10-31', endsOn: '2026-11-01' }), NOW),
      ).toEqual({ value: '31 октября–1 ноября' });
    });

    it('«До старта» — по календарной дате Минска, на границе суток', () => {
      // 20:59 UTC — ещё 1 октября по Минску, 21:00 UTC — уже 2 октября
      expect(daysUntilStart('2026-10-03', new Date('2026-10-01T20:59:00Z'))).toBe(2);
      expect(daysUntilStart('2026-10-03', new Date('2026-10-01T21:00:00Z'))).toBe(1);
    });

    it('строка статуса: склонение, «Старт сегодня», «Идёт сейчас»', () => {
      expect(calendarStatusLine(start({ startsOn: '2026-10-02' }), NOW)).toBe('До старта 1 день.');
      expect(calendarStatusLine(start({ startsOn: '2026-10-04' }), NOW)).toBe('До старта 3 дня.');
      expect(calendarStatusLine(start({ startsOn: '2026-10-06' }), NOW)).toBe('До старта 5 дней.');
      expect(calendarStatusLine(start({ startsOn: '2027-06-14' }), NOW)).toBe(
        'До старта 256 дней.',
      );
      expect(calendarStatusLine(start({ startsOn: '2026-10-01' }), NOW)).toBe('Старт сегодня.');
      expect(calendarStatusLine(start({ startsOn: '2026-09-30', endsOn: '2026-10-02' }), NOW)).toBe(
        'Идёт сейчас.',
      );
    });
  });
});

describe('мета героев', () => {
  it('старт: дистанции · дисциплина · город; неизвестная дисциплина — без подписи', () => {
    expect(calendarMeta(start({ distancesKm: [80, 120] }))).toBe('80 и 120 км · Шоссе · Минск');
    expect(calendarMeta(start({ discipline: 'unknown', distancesKm: [] }))).toBe('Минск');
  });
});
