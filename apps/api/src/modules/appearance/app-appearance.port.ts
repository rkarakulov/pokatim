import type { AppThemeId } from '@pokatim/contracts';

/**
 * Порт `appearance` для других модулей (story-cards: карточка для сторис в теме приложения; через
 * `modules/appearance/index.ts`). Только чтение активной темы — смена темы остаётся в панели.
 */
export const APP_APPEARANCE = Symbol('APP_APPEARANCE');

export interface AppAppearanceSource {
  /** Активная тема приложения; настройки нет — `DEFAULT_APP_THEME_ID`. */
  activeThemeId(): Promise<AppThemeId>;
}
