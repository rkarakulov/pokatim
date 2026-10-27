import type { CatalogRouteDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { ROUTE_CATALOG_LINE_WIDTH, type ScrubStore } from '@pokatim/route-view';

import { routeKm } from './format';
import { catalogRouteMapOptions } from './queries';
import { RouteLineMap } from './route-line-map';

/**
 * Карта маршрута каталога (routes-01, RC-5/RC-16): линия, старт и финиш без коридора — общий `RouteLineMap`
 * (routes-02) с публичным запросом геометрии; линия толще карты гонки (routes-03); маркер скраббинга (routes-04). Подпись — текстовая альтернатива без координат.
 */
export function CatalogRouteMap({
  route,
  scrub,
  fill,
  bottomInset,
}: {
  route: CatalogRouteDetail;
  /** routes-04: маркер скраббинга, связанный с профилем высоты */
  scrub?: ScrubStore;
  /** routes-04d: карта на всю область под шторкой карточки */
  fill?: boolean;
  /** видимая высота шторки, px (`undefined` — не измерена) */
  bottomInset?: number;
}) {
  return (
    <RouteLineMap
      mapQuery={catalogRouteMapOptions(route.id)}
      lineWidth={ROUTE_CATALOG_LINE_WIDTH}
      scrub={scrub}
      fill={fill}
      bottomInset={bottomInset}
      accessibilityLabel={t('routes.detail.map.label', { distance: routeKm(route.distanceM) })}
      failedMessage={t('routes.detail.map.failed')}
      skeletonTestID="catalog-route-map-skeleton"
    />
  );
}
