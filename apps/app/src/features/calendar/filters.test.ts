/// <reference types="jest" />
import type { CalendarStartCard } from '@pokatim/contracts';

import {
  groupByMonth,
  hasFilters,
  NO_FILTERS,
  toggleWithinLimit,
  withinAvailable,
  type CalendarFilters,
} from './filters';

let seq = 0;
const start = (startsOn: string, endsOn: string | null = null): CalendarStartCard => ({
  id: `0190a6f4-0000-7000-8000-${String((seq += 1)).padStart(12, '0')}`,
  title: `Старт ${seq}`,
  startsOn,
  endsOn,
  startTime: null,
  discipline: 'road',
  city: 'Минск',
  distancesKm: [100],
  registrationUrl: null,
  phase: 'upcoming',
});

describe('фильтры календаря', () => {
  const filters: CalendarFilters = {
    discipline: ['gravel'],
    city: ['Брест', 'Минск'],
    month: ['2027-05', '2027-06'],
  };

  it('активен хоть один чип', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, city: ['Минск'] })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, month: ['2027-06'] })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, discipline: ['mtb'] })).toBe(true);
  });

  it('исчезнувшие месяц и город снимаются; строки городов — как в ответе', () => {
    expect(withinAvailable(filters, { months: ['2027-06', '2027-07'], cities: ['Минск'] })).toEqual(
      { discipline: ['gravel'], city: ['Минск'], month: ['2027-06'] },
    );
    // регистр не нормализуется клиентом: «минск» — другое значение чипа
    expect(withinAvailable(filters, { cities: ['минск'] }).city).toEqual([]);
  });

  it('не загружено (undefined) — значения без изменений', () => {
    expect(withinAvailable(filters, {})).toEqual(filters);
    expect(withinAvailable(filters, { months: undefined, cities: ['Брест'] })).toEqual({
      ...filters,
      city: ['Брест'],
    });
  });

  it('предел значений запроса (12): лишнее не добавляется, снять — можно', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `Город ${String(i).padStart(2, '0')}`);
    expect(toggleWithinLimit(twelve, 'Ещё')).toEqual(twelve);
    expect(toggleWithinLimit(twelve, 'Город 00')).toHaveLength(11);
    expect(toggleWithinLimit(['Минск'], 'Брест')).toEqual(['Брест', 'Минск']);
  });
});

describe('groupByMonth', () => {
  it('подпись месяца — при смене месяца начала; многодневный через границу — в месяце начала', () => {
    const a = start('2027-06-14');
    const b = start('2027-06-30', '2027-07-01');
    const c = start('2027-07-05');
    expect(groupByMonth([a, b, c])).toEqual([
      { kind: 'month', month: '2027-06' },
      { kind: 'start', start: a },
      { kind: 'start', start: b },
      { kind: 'month', month: '2027-07' },
      { kind: 'start', start: c },
    ]);
  });

  it('поперёк страниц: склеенные страницы дают одну подпись на месяц', () => {
    const page1 = [start('2027-06-01'), start('2027-06-10')];
    const page2 = [start('2027-06-20'), start('2028-01-03')];
    const rows = groupByMonth([...page1, ...page2]);
    expect(rows.filter((row) => row.kind === 'month')).toEqual([
      { kind: 'month', month: '2027-06' },
      { kind: 'month', month: '2028-01' },
    ]);
    expect(groupByMonth([])).toEqual([]);
  });
});
