import type { MiddlewareSettings } from 'expo-server';

import { refreshSsrTheme, SSR_THEME_PATHS } from '@/features/appearance/ssr-theme';

/**
 * Серверный middleware Expo Router (до рендера): обновляет тему процесса из API — её читают `+html.tsx`, корень
 * (`initialThemeId`) и manifest. Только GET страниц (`SSR_THEME_PATHS`: не `/_expo/*`, не файлы с расширением);
 * запрос не читает, ответа не возвращает. Обращение к API — не чаще раза в 60 с на процесс при любом исходе, ждёт
 * только первая страница процесса, дальше — в фоне (`refreshSsrTheme`). Почему не Express — ADR-0016.
 */
export const unstable_settings: MiddlewareSettings = {
  matcher: { methods: ['GET'], patterns: SSR_THEME_PATHS },
};

export default async function middleware(): Promise<void> {
  await refreshSsrTheme();
}
