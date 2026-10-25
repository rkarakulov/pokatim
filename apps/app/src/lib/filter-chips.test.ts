/// <reference types="jest" />
import { monthChipLabel, toggle } from './filter-chips';

// перенесено из features/races/filters.test.ts без смены ожиданий
describe.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('чипы фильтров в TZ=%s', (tz) => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it('подпись месяца: именительный падеж, год — только не текущего', () => {
    const now = new Date('2026-11-30T12:00:00Z');
    expect(monthChipLabel('2026-11', now)).toBe('Ноябрь');
    expect(monthChipLabel('2027-01', now)).toBe('Январь 2027');
    // 31 декабря 22:00 UTC — в Минске уже 2027
    expect(monthChipLabel('2027-01', new Date('2026-12-31T22:00:00Z'))).toBe('Январь');
  });
});

describe('toggle', () => {
  it('toggle добавляет и снимает, результат отсортирован', () => {
    expect(toggle(['road'], 'gravel')).toEqual(['gravel', 'road']);
    expect(toggle(['gravel', 'road'], 'gravel')).toEqual(['road']);
    expect(toggle(['2026-12'], '2026-11')).toEqual(['2026-11', '2026-12']);
  });
});
