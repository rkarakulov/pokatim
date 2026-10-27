import { AppThemeId, DEFAULT_APP_THEME_ID } from '@pokatim/contracts';

/** Id темы из ответа, кэша или `window`: только из закрытого списка, иначе — «Классика» (`'unknown'`, мусор). */
export function toAppThemeId(value: unknown): AppThemeId {
  const parsed = AppThemeId.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_APP_THEME_ID;
}
