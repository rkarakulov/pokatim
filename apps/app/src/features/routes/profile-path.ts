import type { CatalogRouteElevation } from '@pokatim/contracts';

import { profilePoints } from './format';

/** Единицы `viewBox` графика (не px): график растягивается по блоку (`preserveAspectRatio="none"`). */
export const PROFILE_VIEW_WIDTH = 1000;
export const PROFILE_VIEW_HEIGHT = 250;
export const PROFILE_VIEW_BOX = `0 0 ${PROFILE_VIEW_WIDTH} ${PROFILE_VIEW_HEIGHT}`;

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Пути SVG профиля (web — inline `<svg>`, native — `react-native-svg`, routes-04 G2): линия по всем точкам и площадь
 * под ней до низа графика; меньше двух точек — `null`. Зависят только от данных — SSR = первый рендер.
 */
export function profilePaths(
  elevation: CatalogRouteElevation,
): { line: string; area: string } | null {
  const points = profilePoints(elevation.profile, elevation.minM, elevation.maxM);
  if (points.length === 0) return null;
  const xy = points.map(
    ([x, y]) => `${round(x * PROFILE_VIEW_WIDTH)},${round((1 - y) * PROFILE_VIEW_HEIGHT)}`,
  );
  const line = `M${xy.join('L')}`;
  return {
    line,
    area: `${line}L${PROFILE_VIEW_WIDTH},${PROFILE_VIEW_HEIGHT}L0,${PROFILE_VIEW_HEIGHT}Z`,
  };
}

/** id градиента заливки для `url(#…)`: из `useId` без двоеточий и прочих символов вне `[A-Za-z0-9_-]`. */
export const profileGradientId = (reactId: string) =>
  `profile-fill-${reactId.replace(/[^A-Za-z0-9_-]/g, '')}`;
