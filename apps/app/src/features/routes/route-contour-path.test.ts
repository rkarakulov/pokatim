/// <reference types="jest" />
import { CONTOUR_VIEW } from './route-contour-path';

// путь контура (`contourPath`) — тесты в `@pokatim/route-view` (`line-geometry.test.ts`)
describe('контур героя Главной', () => {
  it('viewBox героя — константа раскладки', () => {
    expect(CONTOUR_VIEW.width).toBeGreaterThan(CONTOUR_VIEW.height);
  });
});
