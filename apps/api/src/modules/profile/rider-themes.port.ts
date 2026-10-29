import type { AppThemeId } from '@pokatim/contracts';

/**
 * Порт `profile` (через `modules/profile/index.ts`, user-theme): личная тема райдера для `sharing` — карточки сторис и
 * приглашения рисуются в теме того, кто их создаёт. Отдаёт только id темы.
 */
export const RIDER_THEMES = Symbol('RIDER_THEMES');

export interface RiderThemes {
  /** Тема пользователя; нет документа профиля или выбора — `DEFAULT_APP_THEME_ID` («Классика»). */
  themeOf(userId: string): Promise<AppThemeId>;
}
