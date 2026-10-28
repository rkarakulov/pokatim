/// <reference types="jest" />
import type { RideRoute } from '@pokatim/contracts';

import { routeChoice } from './route-choice-store';

const route: RideRoute = {
  id: '0190a6f4-0000-7000-8000-000000000101',
  title: 'Минское море',
  distanceM: 62_400,
  elevationGainM: 310,
  access: 'public',
};

beforeEach(() => routeChoice.clear());

describe('выбор маршрута пикера → форма (05c)', () => {
  it('take по своему form возвращает выбор один раз', () => {
    routeChoice.set({ form: 'new', route });
    expect(routeChoice.take('new')).toEqual({ route });
    expect(routeChoice.take('new')).toBeUndefined();
  });

  it('чужой form — выбора нет и он не теряется', () => {
    routeChoice.set({ form: 'ride-1', route: null });
    expect(routeChoice.take('new')).toBeUndefined();
    expect(routeChoice.take('ride-1')).toEqual({ route: null });
  });

  it('новый выбор заменяет прежний', () => {
    routeChoice.set({ form: 'new', route });
    routeChoice.set({ form: 'new', route: null });
    expect(routeChoice.take('new')).toEqual({ route: null });
  });
});
