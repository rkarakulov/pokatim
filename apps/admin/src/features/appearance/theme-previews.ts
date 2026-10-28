import { APP_THEME_IDS, type AppThemeId } from '@pokatim/contracts';
import {
  appThemes,
  type AppColorScheme,
  type AppTheme,
  type AppThemeDefinition,
} from '@pokatim/design-tokens';

/** Мини-макет одной схемы темы: цвета и форма — роли схемы из реестра (не литералы). */
export interface ThemePreviewMock {
  canvas: string;
  card: string;
  text: string;
  accent: string;
  route: string;
  /** радиус карточки макета, px — `shape.card` схемы */
  radius: number;
}

/** Превью темы в карточке выбора: макеты схем, режим схемы и гарнитура (названием). */
export interface ThemePreviewPalette {
  /** `'system'` — светлая и тёмная (два макета), `'dark'` — всегда тёмная (один) */
  colorScheme: AppColorScheme;
  mocks: ThemePreviewMock[];
  /** гарнитура заголовков темы — подписью (файлы шрифтов тем панель не грузит) */
  font: string;
}

function mockOf(scheme: AppTheme): ThemePreviewMock {
  return {
    canvas: scheme.surface.default,
    card: scheme.surface.raised,
    text: scheme.text.primary,
    accent: scheme.action.primary,
    route: scheme.map.route,
    radius: scheme.shape.card,
  };
}

/**
 * Превью темы: экран, карточка, текст, основная кнопка, линия маршрута — у темы «по системе» светлая и тёмная схемы
 * рядом, у «всегда тёмной» — её единственная.
 */
export function previewOf(def: AppThemeDefinition): ThemePreviewPalette {
  const schemes =
    def.colorScheme === 'dark' ? [def.schemes.dark] : [def.schemes.light, def.schemes.dark];
  return { colorScheme: def.colorScheme, mocks: schemes.map(mockOf), font: def.fonts.display };
}

/** Превью всех тем приложения в порядке `APP_THEME_IDS`. */
export const THEME_PREVIEWS = Object.fromEntries(
  APP_THEME_IDS.map((id) => [id, previewOf(appThemes[id])]),
) as Record<AppThemeId, ThemePreviewPalette>;
