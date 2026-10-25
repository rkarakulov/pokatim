/// <reference types="jest" />
import type { CalendarStartCard, RaceCard } from '@pokatim/contracts';

import {
  calendarMeta,
  calendarStatusLine,
  daysUntilStart,
  formatCalendarStartDate,
  formatDistances,
  formatRaceWindow,
  raceLifecycleLine,
  raceMeta,
} from './format';

const race = (overrides: Partial<RaceCard> = {}): RaceCard => ({
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Гравийный коридор',
  bikeClass: 'gravel',
  surfaces: ['gravel'],
  distanceKm: 62,
  // 4 октября 00:00 — 12 октября 23:59 по Минску (UTC+3)
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: null,
  ...overrides,
});

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

  describe('formatRaceWindow', () => {
    it('один месяц — «4–12» + «октября»; текущий год без года', () => {
      expect(formatRaceWindow(race().windowStartsAt, race().windowEndsAt, NOW)).toEqual({
        value: '4–12',
        unit: 'октября',
      });
    });

    it('граница суток Минска: 21:00 UTC — уже следующий день', () => {
      expect(formatRaceWindow('2026-10-04T21:00:00Z', '2026-10-04T21:30:00Z', NOW)).toEqual({
        value: '5',
        unit: 'октября',
      });
    });

    it('разные месяцы — «28 сентября–3 октября»', () => {
      expect(formatRaceWindow('2026-09-27T21:00:00Z', '2026-10-03T20:59:00Z', NOW)).toEqual({
        value: '28 сентября–3 октября',
      });
    });

    it('не текущий год — с годом; разные годы — с годами', () => {
      expect(formatRaceWindow('2027-06-03T21:00:00Z', '2027-06-10T20:59:00Z', NOW)).toEqual({
        value: '4–10',
        unit: 'июня 2027',
      });
      expect(formatRaceWindow('2026-12-27T21:00:00Z', '2027-01-03T20:59:00Z', NOW)).toEqual({
        value: '28 декабря 2026–3 января 2027',
      });
    });
  });

  describe('raceLifecycleLine (фаза — с сервера)', () => {
    it('upcoming — открытие и закрытие с датой и временем Минска', () => {
      expect(raceLifecycleLine(race(), NOW)).toBe(
        'Окно откроется 4 октября, 00:00, закроется 12 октября в 23:59.',
      );
    });

    it('open, до закрытия больше суток — «Окно открыто до …»', () => {
      expect(raceLifecycleLine(race({ phase: 'open' }), new Date('2026-10-05T12:00:00Z'))).toBe(
        'Окно открыто до 12 октября, 23:59.',
      );
    });

    it('open, закрывается сегодня / завтра по Минску', () => {
      const open = race({ phase: 'open' });
      expect(raceLifecycleLine(open, new Date('2026-10-12T06:00:00Z'))).toBe(
        'Окно закрывается сегодня в 23:59.',
      );
      expect(raceLifecycleLine(open, new Date('2026-10-11T06:00:00Z'))).toBe(
        'Окно закрывается завтра в 23:59.',
      );
      // 11 октября 21:30 UTC — уже 12 октября по Минску
      expect(raceLifecycleLine(open, new Date('2026-10-11T21:30:00Z'))).toBe(
        'Окно закрывается сегодня в 23:59.',
      );
    });

    it("'unknown' и прочие фазы — без строки (R9)", () => {
      expect(raceLifecycleLine(race({ phase: 'unknown' }), NOW)).toBeNull();
      expect(raceLifecycleLine(race({ phase: 'closed' }), NOW)).toBeNull();
      expect(raceLifecycleLine(race({ phase: 'cancelled' }), NOW)).toBeNull();
    });
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
  it('дистанции: одна, две, несколько; дробные — с запятой', () => {
    expect(formatDistances([100])).toBe('100 км');
    expect(formatDistances([80, 120])).toBe('80 и 120 км');
    expect(formatDistances([40, 80, 120])).toBe('40, 80 и 120 км');
    expect(formatDistances([42.2])).toBe('42,2 км');
    expect(formatDistances([])).toBeNull();
  });

  it('гонка: дистанция и покрытия; неизвестное покрытие — без подписи (R9)', () => {
    expect(raceMeta(race({ surfaces: ['asphalt', 'gravel'] }))).toBe('62 км · Асфальт · Гравий');
    expect(raceMeta(race({ surfaces: ['unknown', 'gravel'] }))).toBe('62 км · Гравий');
  });

  it('старт: дистанции · дисциплина · город; неизвестная дисциплина — без подписи', () => {
    expect(calendarMeta(start({ distancesKm: [80, 120] }))).toBe('80 и 120 км · Шоссе · Минск');
    expect(calendarMeta(start({ discipline: 'unknown', distancesKm: [] }))).toBe('Минск');
  });
});
