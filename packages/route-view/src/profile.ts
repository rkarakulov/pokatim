import type { CatalogRouteElevation } from '@pokatim/contracts';
import { elevationAt, gainTo, gradeAt, profilePoints, stepDistance } from '@pokatim/tracks';

/*
 * Профиль высоты маршрута без разметки (приложение — native и web, панель — routes-05): пути SVG, оформление, числа
 * скраббинга, тики оси X, шаги клавиш. Подписи (i18n) — у потребителя поверх чисел.
 */

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

/**
 * Заливка под линией профиля (web и native SVG, routes-04 G1): вертикальный градиент цвета линии — у верха площади
 * `PROFILE_FILL_OPACITY`, у низа графика прозрачно — у всех тем приложения и в панели. Токена прозрачности в дизайн-системе нет (как `CORRIDOR_OPACITY`
 * карты); заливка — фон, линия — главное.
 */
export const PROFILE_FILL_OPACITY = 0.28;

/**
 * Фолбэк native без `react-native-svg` (старая dev-сборка): столбики — только заливка, без кромки (кромка из
 * отдельных столбиков ступенчатая, ревью 03b), плотнее градиента — иначе профиль теряется.
 */
export const PROFILE_NATIVE_FILL_OPACITY = 0.3;

/** Пропорция графика (раскладка, не px — как `MAP_ASPECT_RATIO`): ≈ 86 при ширине телефона. */
export const PROFILE_ASPECT_RATIO = 4;

/** Шаги подписей оси X профиля, км: 1/2/5 × 10ⁿ. */
const TICK_MULTIPLIERS = [1, 2, 5] as const;
/** Подписей оси X не больше (с «0»). */
const PROFILE_TICKS_MAX = 5;

/** Тик оси X профиля: км от старта и доля длины оси (0…1). */
export interface ProfileTickValue {
  km: number;
  position: number;
}

/**
 * Тики оси X профиля (routes-03 RC-15): шаг — наименьший из 1/2/5 × 10ⁿ км, при котором тиков (с «0») ≤ 5.
 * 68 км → 0, 20, 40, 60. Длина 0 — тиков нет.
 */
export function profileTickValues(distanceM: number): ProfileTickValue[] {
  const totalKm = distanceM / 1000;
  if (totalKm <= 0) return [];
  let step = 0;
  for (let exponent = -2; step === 0 && exponent <= 4; exponent += 1) {
    for (const multiplier of TICK_MULTIPLIERS) {
      const candidate = multiplier * 10 ** exponent;
      if (Math.floor(totalKm / candidate + 1e-9) + 1 <= PROFILE_TICKS_MAX) {
        step = candidate;
        break;
      }
    }
  }
  const count = Math.floor(totalKm / step + 1e-9) + 1;
  return Array.from({ length: count }, (_, index) => {
    const value = Math.round(index * step * 1000) / 1000;
    return { km: value, position: Math.min(1, (value * 1000) / distanceM) };
  });
}

/** Числа карточки скраббинга: км маршрута (десятые), высота (целые м), уклон (целый %), набор от старта (м). */
export interface ScrubValues {
  km: number;
  elevationM: number;
  grade: number;
  gainM: number;
}

/**
 * Числа скраббинга по доле 0…1 (routes-04 S3, RC-10; S6): км — `f × distanceM` маршрута, высота, уклон и набор — по
 * `f × длина профиля` (расхождение длин компенсирует доля); набор масштабирован к набору сервера `gainM` (RC-9).
 */
export function scrubValues(
  elevation: CatalogRouteElevation,
  distanceM: number,
  gainM: number | null,
  fraction: number,
): ScrubValues {
  const profileD = fraction * (elevation.profile.at(-1)?.[0] ?? 0);
  return {
    km: Math.round((fraction * distanceM) / 100) / 10,
    elevationM: Math.round(elevationAt(elevation.profile, profileD)),
    grade: gradeAt(elevation.profile, profileD),
    gainM: gainTo(elevation.profile, profileD, gainM),
  };
}

/** Шаг adjustable / стрелок по доле: ±1 км маршрута (`stepDistance`), границы 0 и 1; длина 0 — 0. */
export function scrubStep(fraction: number, distanceM: number, direction: 1 | -1): number {
  if (distanceM <= 0) return 0;
  return stepDistance(fraction * distanceM, distanceM, direction) / distanceM;
}

const KEY_STEPS: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};

/**
 * Клавиши slider профиля (web, routes-04 RC-13): ←/↓ и →/↑ — ±1 км (`scrubStep`), Home/End — старт и финиш;
 * прочие клавиши — `null` (событие не трогается).
 */
export function scrubKeyTarget(key: string, fraction: number, distanceM: number): number | null {
  const step = KEY_STEPS[key];
  if (step !== undefined) return scrubStep(fraction, distanceM, step);
  if (key === 'Home') return 0;
  if (key === 'End') return 1;
  return null;
}

/** Доля 0…1 по горизонтали указателя над графиком (`clientX` и прямоугольник графика); ширина 0 — 0. */
export function fractionAt(clientX: number, left: number, width: number): number {
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - left) / width));
}
