import { describe, expect, it } from 'vitest';

import { CITY_CODES, CityCode, isCityCode } from './city.schema.ts';

describe('справочник городов', () => {
  it('коды уникальны, латиница в нижнем регистре; Минск — первый (только в конец)', () => {
    expect(new Set(CITY_CODES).size).toBe(CITY_CODES.length);
    expect(CITY_CODES.length).toBe(25);
    expect(CITY_CODES[0]).toBe('minsk');
    for (const code of CITY_CODES) expect(code).toMatch(/^[a-z]+$/);
  });

  it('запрос строгий: незнакомый код и подпись — ошибка; isCityCode', () => {
    expect(CityCode.parse('gomel')).toBe('gomel');
    expect(CityCode.safeParse('Гомель').success).toBe(false);
    expect(CityCode.safeParse('atlantis').success).toBe(false);
    expect(isCityCode('brest')).toBe(true);
    expect(isCityCode('atlantis')).toBe(false);
  });
});
