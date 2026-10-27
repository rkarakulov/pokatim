import type { CatalogRouteElevation } from '@pokatim/contracts';

/**
 * Профиль высоты маршрута для ответа (routes-03 карточка каталога, routes-05 страница панели): мин. и макс. — по
 * точкам профиля; профиля нет (нет высот или ещё не посчитан) — `null`.
 */
export function elevationOf(profile: [number, number][] | null): CatalogRouteElevation | null {
  if (!profile) return null;
  const elevations = profile.map(([, elevation]) => elevation);
  return { minM: Math.min(...elevations), maxM: Math.max(...elevations), profile };
}
