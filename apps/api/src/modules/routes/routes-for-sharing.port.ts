import type { CityCode, LonLat } from '@pokatim/contracts';

/**
 * Порт `routes` для модуля `sharing` (OG-картинка маршрута каталога, og-images, через `modules/routes/index.ts`):
 * публичные факты маршрута **в каталоге**, его линия показа и маршруты каталога, изменившиеся после курсора
 * (пререндер `og.sync`). Без автора и владельца.
 */
export const ROUTES_FOR_SHARING = Symbol('ROUTES_FOR_SHARING');

export interface RouteOgFacts {
  routeId: string;
  title: string;
  distanceM: number;
  elevationGainM: number | null;
  isLoop: boolean;
  city: CityCode;
}

export interface RoutesForSharing {
  /** Только маршрут каталога (`IN_CATALOG`, готовый); заявка, снятый, удалённый, неизвестный — `null`. */
  ogFacts(routeId: string): Promise<RouteOgFacts | null>;
  /** Линия показа маршрута, пока он в каталоге (только worker); иначе `null`. */
  ogLine(routeId: string): Promise<LonLat[] | null>;
  /** Маршруты каталога, изменившиеся строго после курсора, по `(updatedAt, _id)`, не больше `limit`. */
  ogChanged(
    after: { at: Date; id: string } | null,
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]>;
  /**
   * Маршруты каталога по `_id` ↑ строго после `after` до `until` включительно (`null` — без границы), не больше `limit` —
   * карта сайта (sitemap-index).
   */
  sitemapRange(
    range: { after: string | null; until: string | null },
    limit: number,
  ): Promise<{ id: string; updatedAt: Date }[]>;
}
