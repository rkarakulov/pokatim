import type { AppThemeId } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';

/** Цвета мини-макета темы в карточке выбора (значения — из токенов темы, не литералы). */
export interface ThemePreviewPalette {
  canvas: string;
  card: string;
  text: string;
  accent: string;
  route: string;
}

const classic = themes.light;

/**
 * Шов превью тем (app-themes D1, решение 8.1 F1): «Классика» — из существующей светлой темы, остальные — нейтральный
 * макет «Превью появится позже». Палитры шести новых тем появятся в реестре `appThemes` (`@pokatim/design-tokens`,
 * слайсы B/C). TODO(app-themes D2): строить модуль из `appThemes` (`previewOf(def)`), удалить ветку `null`.
 */
export const THEME_PREVIEWS: Record<AppThemeId, ThemePreviewPalette | null> = {
  classic: {
    canvas: classic.surface.raised,
    card: classic.surface.default,
    text: classic.text.primary,
    accent: classic.text.accent,
    route: classic.map.route,
  },
  atlas: null,
  chrono: null,
  planner: null,
  journal: null,
  navigation: null,
  typography: null,
};
