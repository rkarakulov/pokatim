/*
 * Время в пути по покрытию (routes-03 P3) — карточка приложения и страница маршрута панели (routes-05, RC-11).
 */

/**
 * Средняя скорость по покрытию для оценки времени в пути, км/ч (`[ASSUMPTION]` P3 routes-03): асфальт 27, гравий 20,
 * асфальт + гравий 24; покрытие неизвестно — как асфальт. Набор высоты не учитывается (v1).
 */
export const ROUTE_PACE_KMH = { asphalt: 27, gravel: 20, mixed: 24 } as const;

/** Шаг округления времени в пути, мин (и минимум). */
const DURATION_STEP_MIN = 5;

/** Скорость по известным покрытиям маршрута; ни одного известного (или маршрут не в каталоге) — асфальт. */
export function routePaceKmh(surfaces: readonly string[]): number {
  const asphalt = surfaces.includes('asphalt');
  const gravel = surfaces.includes('gravel');
  if (asphalt && gravel) return ROUTE_PACE_KMH.mixed;
  if (gravel) return ROUTE_PACE_KMH.gravel;
  return ROUTE_PACE_KMH.asphalt;
}

/** Время в пути, мин: дистанция ÷ скорость, до 5 мин, не меньше 5 мин. */
export function routeDurationMin(distanceM: number, paceKmh: number): number {
  const minutes = (distanceM / 1000 / paceKmh) * 60;
  return Math.max(DURATION_STEP_MIN, Math.round(minutes / DURATION_STEP_MIN) * DURATION_STEP_MIN);
}
