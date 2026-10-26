/**
 * URL стиля MapLibre (ADR-0014): только из публичного env сборки, без кода провайдера. Обращение — прямое
 * `process.env.EXPO_PUBLIC_*` (Metro подставляет значение в бандл). Не задан или пустой — карты нет.
 */
export function mapStyleUrl(dark: boolean): string | null {
  const url = dark
    ? process.env.EXPO_PUBLIC_MAP_STYLE_DARK
    : process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
  return url ? url : null;
}
