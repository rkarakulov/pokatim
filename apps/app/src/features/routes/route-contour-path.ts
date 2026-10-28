import type { RouteMapGeometry } from '@pokatim/contracts';
import type { ContourView } from '@pokatim/route-view';

// путь контура — общий код `@pokatim/route-view` (герой Главной, карточка для сторис в API)
export { contourPath, type ContourView } from '@pokatim/route-view';

/** viewBox контура героя Главной: пропорция ≈ панели героя на телефоне. */
export const CONTOUR_VIEW: ContourView = { width: 320, height: 200, padding: 16 };

/** Общий API контура (`route-contour.tsx` — native, `route-contour.web.tsx` — web). */
export interface RouteContourProps {
  geometry: Pick<RouteMapGeometry, 'line' | 'bounds'>;
  /** цвет линии маршрута */
  color: string;
  /** заливка точки старта (`map.start`, контрастна к линии); обводка — цвет линии */
  startColor: string;
}

/** Радиус точки старта, единицы `viewBox` (контур вписан в `CONTOUR_VIEW`). */
export const CONTOUR_START_RADIUS = 5;
