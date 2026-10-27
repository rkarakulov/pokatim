import { AppAppearance, DEFAULT_APP_THEME_ID, type AppThemeId } from '@pokatim/contracts';

import { fetchPublicForSsr } from '@/lib/public-ssr';

import { toAppThemeId } from './theme-id';

/**
 * Тема процесса web-сервера (SSR). Тема глобальна (T1): одна на процесс, как кэш публичных данных `public-ssr.ts`, —
 * поэтому исключение из «сторов не на уровне модуля»: не сессия и не ПДн. Ключ — `Symbol.for` в `globalThis`: серверные
 * бандлы рендера, `+middleware.ts` и API-маршрутов — разные графы модулей одного процесса, переменная модуля им общей
 * не была бы.
 */
const KEY = Symbol.for('pokatim.appTheme');
const holder = globalThis as { [KEY]?: AppThemeId };

/** Активная тема процесса; ещё не узнавали — «Классика». */
export function ssrThemeId(): AppThemeId {
  return holder[KEY] ?? DEFAULT_APP_THEME_ID;
}

/**
 * Обновить тему из API (`+middleware.ts`, перед рендером): кэш `fetchPublicForSsr` — не чаще раза в 60 с, таймаут 2 с.
 * API недоступен — остаётся последняя известная.
 */
export async function refreshSsrTheme(): Promise<void> {
  const result = await fetchPublicForSsr('/v1/appearance', AppAppearance);
  if (result.status === 'found') holder[KEY] = toAppThemeId(result.data.themeId);
}
