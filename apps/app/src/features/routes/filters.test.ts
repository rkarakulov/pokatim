/// <reference types="jest" />
import { hasFilters, NO_FILTERS, withinAvailable } from './filters';

describe('фильтры каталога маршрутов (routes-01)', () => {
  it('без выбора — фильтров нет; любой выбор — есть', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, distance: ['lt50'] })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, surface: ['gravel'] })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, city: ['minsk'] })).toBe(true);
  });

  it('исчезнувший город снимается; до ответа — без изменений', () => {
    const filters = {
      ...NO_FILTERS,
      city: ['brest', 'minsk'] as const,
      distance: ['gt100'] as const,
    };
    expect(withinAvailable(filters, undefined)).toBe(filters);
    expect(withinAvailable(filters, ['minsk', 'grodno'])).toEqual({
      ...filters,
      city: ['minsk'],
    });
  });
});
