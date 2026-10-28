import { DEFAULT_APP_DECOR_ID, type AppDecorId } from '@pokatim/contracts';

import { useDecorQuery } from '@/features/appearance/appearance-query';
import { useMounted } from '@/lib/use-minsk-clock';

/**
 * Сезонный декор (halloween-decor): ответ сервера после монтирования. SSR и гидрация web — без декора (разметка
 * совпадает), native — с первого ответа (кэша нет). Нет ответа, ошибка, незнакомый — без декора.
 */
export function useAppDecor(): AppDecorId {
  const { data } = useDecorQuery();
  const mounted = useMounted();
  return mounted ? (data ?? DEFAULT_APP_DECOR_ID) : DEFAULT_APP_DECOR_ID;
}
