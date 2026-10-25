/// <reference types="jest" />
import { hasFilters, monthChips, NO_FILTERS, noMatchMessage } from './filters';

describe.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('фильтры вкладки в TZ=%s', (tz) => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it('месяцы: текущий по Минску и два следующих; переход через год', () => {
    expect(monthChips(new Date('2026-10-15T12:00:00Z'))).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(monthChips(new Date('2026-11-30T12:00:00Z'))).toEqual(['2026-11', '2026-12', '2027-01']);
    // январь → март: 31-дневный шаг не перескакивает короткий февраль
    expect(monthChips(new Date('2027-01-31T12:00:00Z'))).toEqual(['2027-01', '2027-02', '2027-03']);
  });

  it('граница суток Минска: 31 октября 21:00 UTC — уже ноябрь', () => {
    expect(monthChips(new Date('2026-10-31T20:59:00Z'))[0]).toBe('2026-10');
    expect(monthChips(new Date('2026-10-31T21:00:00Z'))[0]).toBe('2026-11');
  });
});

describe('состояние фильтров', () => {
  it('активен хоть один чип', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ bikeClass: [], month: ['2026-11'] })).toBe(true);
    expect(hasFilters({ bikeClass: ['mtb'], month: [] })).toBe(true);
  });

  it('текст пустого результата: класс и месяц — конкретно, иначе — общий', () => {
    expect(noMatchMessage({ bikeClass: ['mtb'], month: ['2026-11'] })).toBe(
      'Нет гонок класса «МТБ» в ноябре.',
    );
    expect(noMatchMessage({ bikeClass: ['mtb'], month: [] })).toBe(
      'Нет гонок по выбранным фильтрам.',
    );
    expect(noMatchMessage({ bikeClass: ['mtb', 'road'], month: ['2026-11'] })).toBe(
      'Нет гонок по выбранным фильтрам.',
    );
  });
});
