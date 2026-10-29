import type { OgCardKind } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { prepareShareImage, shareImageSupported, type ShareImage } from '@/lib/share-image';

/** Сколько считаем подготовленную картинку свежей, мс (версия меняется с содержимым объекта). */
const SHARE_IMAGE_STALE_MS = 60_000;

/**
 * OG-картинка объекта (og-images, ADR-0018) для «Поделиться» файлом — готовится заранее, пока экран открыт: web
 * вызывает `navigator.share` синхронно в обработчике нажатия (RC-13). Версию считает только API
 * (`GET /v1/og/cards/<вид>/<id>`), PNG — по ней. Пока не готова, не загрузилась (объект не публичный — 404, нет сети) или
 * платформа без файлов — `undefined`: кнопка не ждёт и не блокируется, «Поделиться» отправляет ссылку, как раньше.
 * `kind = null` — у объекта нет своей картинки.
 */
export function useShareImage(
  kind: OgCardKind | null,
  id: string,
  enabled: boolean,
): ShareImage | undefined {
  const query = useQuery({
    queryKey: ['share-image', kind, id] as const,
    queryFn: async () => {
      const { version } = await api.getOgCard(kind!, id);
      return prepareShareImage(api.ogImageUrl(kind!, id, version));
    },
    enabled: enabled && kind !== null && shareImageSupported(),
    staleTime: SHARE_IMAGE_STALE_MS,
    gcTime: 5 * 60_000,
    // необязательная картинка: без повторов — сразу фолбэк на ссылку
    retry: false,
  });
  return query.data;
}
