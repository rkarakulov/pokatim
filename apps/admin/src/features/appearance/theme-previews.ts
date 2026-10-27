import { APP_THEME_IDS, type AppThemeId } from '@pokatim/contracts';
import { appThemes, type AppThemeDefinition } from '@pokatim/design-tokens';

/** Мини-макет темы в карточке выбора: цвета и форма — роли темы из реестра (не литералы), гарнитура — названием. */
export interface ThemePreviewPalette {
  canvas: string;
  card: string;
  text: string;
  accent: string;
  route: string;
  /** радиус карточки макета, px — `shape.card` темы */
  radius: number;
  /** гарнитура заголовков темы — подписью (файлы шрифтов тем панель не грузит) */
  font: string;
}

/**
 * Превью темы по светлой схеме (у «всегда тёмных» тем это та же схема, что тёмная): экран, карточка, текст, основная
 * кнопка, линия маршрута.
 */
export function previewOf(def: AppThemeDefinition): ThemePreviewPalette {
  const scheme = def.schemes.light;
  return {
    canvas: scheme.surface.default,
    card: scheme.surface.raised,
    text: scheme.text.primary,
    accent: scheme.action.primary,
    route: scheme.map.route,
    radius: scheme.shape.card,
    font: def.fonts.display,
  };
}

/** Превью всех тем приложения в порядке `APP_THEME_IDS`. */
export const THEME_PREVIEWS = Object.fromEntries(
  APP_THEME_IDS.map((id) => [id, previewOf(appThemes[id])]),
) as Record<AppThemeId, ThemePreviewPalette>;
