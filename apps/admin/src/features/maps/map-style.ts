/**
 * URL стиля MapLibre панели (routes-05, ADR-0014): только из env сборки `VITE_MAP_STYLE_LIGHT`, без кода провайдера.
 * Не задан или пустой — `null`: карты нет, вместо неё превью линии (`LinePreview`, RC-9).
 */
export function mapStyleUrl(): string | null {
  const url = import.meta.env.VITE_MAP_STYLE_LIGHT;
  return url ? url : null;
}
