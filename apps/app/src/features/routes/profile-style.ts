import type { AppThemeLayout } from '@pokatim/design-tokens';

/**
 * Заливка под линией профиля (web и native SVG, routes-04 G1): вертикальный градиент цвета линии — у верха площади
 * `PROFILE_FILL_OPACITY`, у низа графика прозрачно. Токена прозрачности в дизайн-системе нет (как `CORRIDOR_OPACITY`
 * карты); заливка — фон, линия — главное.
 */
export const PROFILE_FILL_OPACITY = 0.28;

/** Сплошная заливка (вариант `solid`, app-themes C2): одна прозрачность сверху и снизу. */
export const PROFILE_SOLID_OPACITY = 0.45;

/**
 * Заливка профиля по раскладке темы (`layout.profileFill`): прозрачности стопов у линии и у низа графика; `null` —
 * площадь не рисуется, только линия.
 */
export const PROFILE_FILL: Readonly<
  Record<AppThemeLayout['profileFill'], { top: number; bottom: number } | null>
> = {
  gradient: { top: PROFILE_FILL_OPACITY, bottom: 0 },
  solid: { top: PROFILE_SOLID_OPACITY, bottom: PROFILE_SOLID_OPACITY },
  line: null,
};

/**
 * Фолбэк native без `react-native-svg` (старая dev-сборка): столбики — только заливка, без кромки (кромка из
 * отдельных столбиков ступенчатая, ревью 03b), плотнее градиента — иначе профиль теряется.
 */
export const PROFILE_NATIVE_FILL_OPACITY = 0.3;

/** Пропорция графика (раскладка, не px — как `MAP_ASPECT_RATIO`): ≈ 86 при ширине телефона. */
export const PROFILE_ASPECT_RATIO = 4;
