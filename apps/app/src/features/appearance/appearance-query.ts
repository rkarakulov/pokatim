import type { AppThemeId } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import { toAppThemeId } from './theme-id';

export const appearanceKeys = { current: ['appearance'] as const };

/**
 * Тема приложения с сервера (публичный `GET /v1/appearance`, T1): данные — уже id из закрытого списка. Перезапрос —
 * по умолчаниям клиента: возврат в приложение / фокус вкладки старше `DEFAULT_STALE_MS`. Ошибка — без UI (тема
 * остаётся прежней).
 */
export function useAppearanceQuery() {
  return useQuery({
    queryKey: appearanceKeys.current,
    queryFn: async (): Promise<AppThemeId> => toAppThemeId((await api.getAppearance())?.themeId),
  });
}
