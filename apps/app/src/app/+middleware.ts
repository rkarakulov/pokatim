import type { MiddlewareSettings } from 'expo-server';

import { refreshSsrTheme } from '@/features/appearance/ssr-theme';

/**
 * Серверный middleware Expo Router (до рендера, loader-ов и API-маршрутов): обновляет тему процесса из API — её
 * читают `+html.tsx`, корень (`initialThemeId`) и manifest. Запрос не читает, ответа не возвращает; не чаще раза в 60 с
 * (кэш `fetchPublicForSsr`). Статику `/_expo/static` Express отдаёт раньше — сюда она не доходит. Почему не Express —
 * ADR-0016.
 */
export const unstable_settings: MiddlewareSettings = { matcher: { methods: ['GET'] } };

export default async function middleware(): Promise<void> {
  await refreshSsrTheme();
}
