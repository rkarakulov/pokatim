import { AppDecorId, DEFAULT_APP_DECOR_ID } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const appearanceKeys = { current: ['appearance'] as const };

/** Декор из ответа: только из закрытого списка; нет поля (старый API), `'unknown'` — без декора. */
export function toAppDecorId(value: unknown): AppDecorId {
  return AppDecorId.safeParse(value).data ?? DEFAULT_APP_DECOR_ID;
}

/**
 * Сезонный декор с сервера (halloween-decor; публичный `GET /v1/appearance`, задаёт панель). Тема в ответе устарела
 * (всегда «Классика») и не читается: тема — личная, из профиля (user-theme, `use-active-theme-id.ts`). Перезапрос — по
 * умолчаниям клиента: возврат в приложение / фокус вкладки старше `DEFAULT_STALE_MS`. Ошибка — без UI (декор прежний).
 */
export function useDecorQuery() {
  return useQuery({
    queryKey: appearanceKeys.current,
    queryFn: async (): Promise<AppDecorId> => toAppDecorId((await api.getAppearance())?.decor),
  });
}
