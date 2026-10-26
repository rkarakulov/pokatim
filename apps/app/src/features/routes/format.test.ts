/// <reference types="jest" />
import type { CatalogRouteCard } from '@pokatim/contracts';

import { routeHeroDate, routeKm, routePlace, routeShareDescription, routeStats } from './format';

const route = (overrides: Partial<CatalogRouteCard> = {}): CatalogRouteCard => ({
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 1_240,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt', 'gravel'],
  publishedAt: '2026-10-20T10:00:00.000Z',
  ...overrides,
});
const text = (value: string | null) => value?.replace(/\u00a0/g, ' ');

describe('подписи маршрута каталога (routes-01)', () => {
  it('км — с десятыми, без лишнего нуля', () => {
    expect(routeKm(86_012)).toBe('86 км');
    expect(text(routeKm(48_550))).toBe('48,6 км');
    expect(routeHeroDate(route({ distanceM: 48_550 }))).toEqual({ value: '48,6', unit: 'км' });
  });

  it('статистика: км · набор · петля; набор null и не петля — без своих частей', () => {
    expect(text(routeStats(route()))).toBe('86 км · набор 1 240 м · петля');
    expect(routeStats(route({ elevationGainM: null, isLoop: false }))).toBe('86 км');
  });

  it('место: город · покрытия строчными; unknown — без своей части', () => {
    expect(routePlace(route())).toBe('Минск · асфальт, гравий');
    expect(routePlace(route({ city: 'unknown', surfaces: ['unknown', 'gravel'] }))).toBe('гравий');
    expect(routePlace(route({ city: 'unknown', surfaces: ['unknown'] }))).toBe('');
  });

  it('описание для мета/OG: только цифры и город, без ПДн', () => {
    expect(text(routeShareDescription(route()))).toBe('86 км · набор 1 240 м · петля · Минск');
  });
});
