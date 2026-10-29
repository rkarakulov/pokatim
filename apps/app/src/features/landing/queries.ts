import type { CatalogRouteListParams } from '@pokatim/api-client';
import type { CatalogRoutePage } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/** Сервер отдаёт публичные списки с `public, max-age=60`. */
const PUBLIC_LIST_STALE_MS = 60_000;

/**
 * Маршруты раздела «Маршруты» лендинга (RC-5): только маршруты команды — маршруты райдеров — UGC с `noindex`, а
 * лендинг индексируется. Из этих же параметров строится путь SSR-посева.
 */
export const LANDING_ROUTES: CatalogRouteListParams = { author: ['team'], limit: 3 };

/**
 * До трёх последних маршрутов команды; ключ с префиксом вкладки `['routes', 'list']` (инвалидация общая), с ключами
 * Главной (`{ limit: 1 }`) и ленты (`[…, 'pages']`) не пересекается. `seed` — посев SSR (`initialData`).
 */
export function useLandingRoutes(seed?: CatalogRoutePage) {
  return useQuery({
    queryKey: ['routes', 'list', LANDING_ROUTES],
    queryFn: () => api.listCatalogRoutes(LANDING_ROUTES),
    initialData: seed,
    staleTime: PUBLIC_LIST_STALE_MS,
  });
}
