import type { AppThemeId } from '@pokatim/contracts';

import { toAppThemeId } from './theme-id';

/**
 * Cookie личной темы (user-theme): пишет клиент web своего origin (`appearance-cache.web.ts`), читает web-сервер при
 * SSR (`ssr-theme.ts`). Не секрет и не httpOnly — по замыслу; значение доверенным не считается.
 */
export const THEME_COOKIE = 'pokatim_theme';

/**
 * Тема из заголовка `Cookie`: первая cookie `pokatim_theme` с id из закрытого списка; нет такой (нет cookie, мусор,
 * незнакомый id) — `null`. Разбор — `split`, без регулярок: линейно на любой длине заголовка.
 */
export function themeIdFromCookieHeader(header: string | null | undefined): AppThemeId | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== THEME_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    const id = toAppThemeId(value);
    // `toAppThemeId` сводит мусор к «Классике» — берём только точное совпадение со списком
    if (id === value) return id;
  }
  return null;
}
