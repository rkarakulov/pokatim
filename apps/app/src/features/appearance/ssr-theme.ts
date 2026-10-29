import { DEFAULT_APP_THEME_ID, type AppThemeId } from '@pokatim/contracts';
import { requestHeaders } from 'expo-server';

import { themeIdFromCookieHeader } from './theme-cookie';

/**
 * Тема SSR web (user-theme, ADR-0021): cookie `pokatim_theme` текущего запроса. Заголовки — `requestHeaders()`
 * expo-server: адаптер `expo-server/adapter/express` исполняет каждый запрос в своём `AsyncLocalStorage`, общем для
 * серверных бандлов процесса (`Symbol.for('expoServerRuntime')`), — рендер `+html.tsx` и корня видят свой запрос. Вне
 * запроса (dev-сервер `expo start`, jest) `requestHeaders()` бросает — «Классика», клиент догонит профилем.
 */
export function ssrThemeId(): AppThemeId {
  try {
    return themeIdFromCookieHeader(requestHeaders().get('cookie')) ?? DEFAULT_APP_THEME_ID;
  } catch {
    return DEFAULT_APP_THEME_ID;
  }
}
