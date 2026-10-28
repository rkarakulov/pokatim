import { AppDecorId, DEFAULT_APP_DECOR_ID, type AppThemeId } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import { toAppThemeId } from './theme-id';

export const appearanceKeys = { current: ['appearance'] as const };

/** Оформление из ответа сервера: id из закрытых списков (незнакомые — «Классика» и без декора). */
interface Appearance {
  themeId: AppThemeId;
  decor: AppDecorId;
}

/** Декор из ответа: только из закрытого списка; нет поля (старый API), `'unknown'` — без декора. */
export function toAppDecorId(value: unknown): AppDecorId {
  return AppDecorId.safeParse(value).data ?? DEFAULT_APP_DECOR_ID;
}

/**
 * Оформление с сервера (публичный `GET /v1/appearance`, T1). Перезапрос — по умолчаниям клиента: возврат в
 * приложение / фокус вкладки старше `DEFAULT_STALE_MS`. Ошибка — без UI (тема и декор остаются прежними).
 */
function useAppearance<T>(select: (appearance: Appearance) => T) {
  return useQuery({
    queryKey: appearanceKeys.current,
    queryFn: async (): Promise<Appearance> => {
      const appearance = await api.getAppearance();
      return {
        themeId: toAppThemeId(appearance?.themeId),
        decor: toAppDecorId(appearance?.decor),
      };
    },
    select,
  });
}

const selectThemeId = (appearance: Appearance) => appearance.themeId;
const selectDecor = (appearance: Appearance) => appearance.decor;

/** Тема приложения с сервера (app-themes). */
export function useAppearanceQuery() {
  return useAppearance(selectThemeId);
}

/** Сезонный декор с сервера (halloween-decor). */
export function useDecorQuery() {
  return useAppearance(selectDecor);
}
