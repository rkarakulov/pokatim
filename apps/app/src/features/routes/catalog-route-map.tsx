import type { CatalogRouteDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { ROUTE_CATALOG_LINE_WIDTH } from '@/features/maps/corridor-style';

import { routeKm } from './format';
import { catalogRouteMapOptions } from './queries';
import { RouteLineMap } from './route-line-map';

/**
 * Карта маршрута каталога (routes-01, RC-5/RC-16): линия, старт и финиш без коридора — общий `RouteLineMap`
 * (routes-02) с публичным запросом геометрии; линия толще карты гонки (routes-03). Подпись — текстовая альтернатива без координат.
 */
export function CatalogRouteMap({ route }: { route: CatalogRouteDetail }) {
  return (
    <RouteLineMap
      mapQuery={catalogRouteMapOptions(route.id)}
      lineWidth={ROUTE_CATALOG_LINE_WIDTH}
      accessibilityLabel={t('routes.detail.map.label', { distance: routeKm(route.distanceM) })}
      failedMessage={t('routes.detail.map.failed')}
      skeletonTestID="catalog-route-map-skeleton"
    />
  );
}
