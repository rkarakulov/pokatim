import { describe, expect, it } from 'vitest';

import { calendarPhase } from './calendar.policy';

const TODAY = '2026-10-22';

describe('calendarPhase', () => {
  it('однодневный: завтра — upcoming, сегодня — ongoing, вчера — finished', () => {
    expect(calendarPhase({ startsOn: '2026-10-23', endsOn: null }, TODAY)).toBe('upcoming');
    expect(calendarPhase({ startsOn: '2026-10-22', endsOn: null }, TODAY)).toBe('ongoing');
    expect(calendarPhase({ startsOn: '2026-10-21', endsOn: null }, TODAY)).toBe('finished');
  });

  it('многодневный: до, первый день, последний день, после', () => {
    const start = { startsOn: '2026-10-21', endsOn: '2026-10-23' };
    expect(calendarPhase(start, '2026-10-20')).toBe('upcoming');
    expect(calendarPhase(start, '2026-10-21')).toBe('ongoing');
    expect(calendarPhase(start, '2026-10-23')).toBe('ongoing');
    expect(calendarPhase(start, '2026-10-24')).toBe('finished');
  });

  it('сравнение строк LocalDate через границу месяца и года', () => {
    expect(calendarPhase({ startsOn: '2026-12-31', endsOn: '2027-01-02' }, '2027-01-01')).toBe(
      'ongoing',
    );
    expect(calendarPhase({ startsOn: '2027-01-01', endsOn: null }, '2026-12-31')).toBe('upcoming');
  });
});
