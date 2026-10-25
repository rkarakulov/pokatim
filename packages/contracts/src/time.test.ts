import { afterEach, describe, expect, it } from 'vitest';

import {
  addLocalDays,
  LocalDate,
  LocalTime,
  minskDayStartUtc,
  minskToday,
  minskWallTimeToUtc,
  UtcMinute,
  utcToMinskWallTime,
  YearMonth,
} from './time.ts';

/** `process.env` без типов Node (пакет — чистый TS). */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env;
const ORIGINAL_TZ = env.TZ;
afterEach(() => {
  env.TZ = ORIGINAL_TZ;
});

/** Пояс процесса не влияет на перевод (Node перечитывает `TZ` при присваивании). */
describe.each(['UTC', 'America/New_York', 'Europe/Minsk', 'Asia/Tokyo'])(
  'время Минска при TZ=%s',
  (tz) => {
    it('настенное время → UTC: 23:59, полночь, конец года', () => {
      env.TZ = tz;
      expect(minskWallTimeToUtc('2026-10-25T23:59')).toBe('2026-10-25T20:59:00Z');
      expect(minskWallTimeToUtc('2026-10-26T00:00')).toBe('2026-10-25T21:00:00Z');
      expect(minskWallTimeToUtc('2026-12-31T23:59')).toBe('2026-12-31T20:59:00Z');
      expect(minskWallTimeToUtc('2027-01-01T02:30')).toBe('2026-12-31T23:30:00Z');
    });

    it('UTC → настенное время и обратно', () => {
      env.TZ = tz;
      expect(utcToMinskWallTime('2026-10-25T20:59:00.000Z')).toBe('2026-10-25T23:59');
      expect(utcToMinskWallTime('2026-12-31T21:00:00Z')).toBe('2027-01-01T00:00');
      const wall = '2026-03-29T03:15';
      expect(utcToMinskWallTime(minskWallTimeToUtc(wall))).toBe(wall);
    });

    it('начало дня и «сегодня» по Минску', () => {
      env.TZ = tz;
      expect(minskDayStartUtc('2026-04-01').toISOString()).toBe('2026-03-31T21:00:00.000Z');
      expect(minskToday(new Date('2026-10-21T20:59:59Z'))).toBe('2026-10-21');
      expect(minskToday(new Date('2026-10-21T21:00:00Z'))).toBe('2026-10-22');
    });
  },
);

describe('ошибки и даты', () => {
  it('несуществующее и кривое настенное время — RangeError', () => {
    expect(() => minskWallTimeToUtc('2026-02-30T10:00')).toThrow(RangeError);
    expect(() => minskWallTimeToUtc('2026-10-25T24:00')).toThrow(RangeError);
    expect(() => minskWallTimeToUtc('2026-10-25 10:00')).toThrow(RangeError);
  });

  it('addLocalDays — через границы месяца и года', () => {
    expect(addLocalDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('схемы времени', () => {
  it('LocalDate: валидная дата; 2026-02-30 и время — ошибка', () => {
    expect(LocalDate.parse('2026-04-01')).toBe('2026-04-01');
    expect(LocalDate.safeParse('2026-02-30').success).toBe(false);
    expect(LocalDate.safeParse('2026-04-01T00:00').success).toBe(false);
  });

  it('LocalTime, YearMonth', () => {
    expect(LocalTime.parse('08:00')).toBe('08:00');
    expect(LocalTime.safeParse('24:00').success).toBe(false);
    expect(LocalTime.safeParse('8:00').success).toBe(false);
    expect(YearMonth.parse('2026-10')).toBe('2026-10');
    expect(YearMonth.safeParse('2026-13').success).toBe(false);
  });

  it('UtcMinute: только Z и целая минута', () => {
    expect(UtcMinute.parse('2026-10-25T20:59:00Z')).toBe('2026-10-25T20:59:00Z');
    expect(UtcMinute.parse('2026-10-25T20:59:00.000Z')).toBe('2026-10-25T20:59:00.000Z');
    expect(UtcMinute.safeParse('2026-10-25T20:59:30Z').success).toBe(false);
    expect(UtcMinute.safeParse('2026-10-25T20:59:00.500Z').success).toBe(false);
    expect(UtcMinute.safeParse('2026-10-25T23:59:00+03:00').success).toBe(false);
    expect(UtcMinute.safeParse('2026-10-25').success).toBe(false);
  });
});
