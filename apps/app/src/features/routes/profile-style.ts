/**
 * Заливка под линией профиля (web и native SVG, routes-04 G1): вертикальный градиент цвета линии — у верха площади
 * `PROFILE_FILL_OPACITY`, у низа графика прозрачно. Токена прозрачности в дизайн-системе нет (как `CORRIDOR_OPACITY`
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
