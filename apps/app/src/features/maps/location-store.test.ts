import { createLocationStore } from './location-store';

describe('location-store (routes-04d, RC-13)', () => {
  it('на экземпляр: начально точки нет, сторы независимы', () => {
    const first = createLocationStore();
    const second = createLocationStore();
    expect(first.getState().lngLat).toBeNull();
    first.setState({ lngLat: [27.56, 53.9] });
    expect(first.getState().lngLat).toEqual([27.56, 53.9]);
    expect(second.getState().lngLat).toBeNull();
  });
});
