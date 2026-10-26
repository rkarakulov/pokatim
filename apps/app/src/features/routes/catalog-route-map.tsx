import type { CatalogRouteDetail } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { SkeletonGroup } from '@rkarakulov/ui';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { MAP_ASPECT_RATIO } from '@/features/maps/corridor-style';
import { RouteMap } from '@/features/maps/route-map';
import { withoutCorridor } from '@/features/maps/route-geometry';
import { useMapStyle } from '@/features/maps/use-map-style';

import { routeKm } from './format';
import { useCatalogRouteMap } from './queries';

/**
 * Карта маршрута каталога (routes-01, RC-5/RC-16): линия, старт и финиш без коридора. SSR и первый клиентский рендер
 * — место карты (скелетон той же пропорции): env стиля и геометрия известны только после монтирования. Затем: env не
 * задан, нативного модуля нет, геометрия 404 или ошибка без данных — блока нет (цифры карточки остаются); иначе —
 * карта по теме приложения. Подпись — текстовая альтернатива без координат.
 */
export function CatalogRouteMap({ route }: { route: CatalogRouteDetail }) {
  const { mounted, styleUrl, theme } = useMapStyle();
  const geometry = useCatalogRouteMap(route.id, styleUrl !== null);
  const map = useMemo(
    () => (geometry.data ? withoutCorridor(geometry.data) : null),
    [geometry.data],
  );

  if (mounted && (styleUrl === null || (geometry.isError && !geometry.data))) return null;
  if (!map || styleUrl === null) {
    return (
      <SkeletonGroup>
        <View
          testID="catalog-route-map-skeleton"
          style={[styles.place, { backgroundColor: theme.surface.skeleton }]}
        />
      </SkeletonGroup>
    );
  }
  return (
    <RouteMap
      // смена стиля (темы) — новая карта: сброс ошибки прошлого стиля; native-камера применяет рамку один раз
      key={`${styleUrl}|${map.bounds.join(',')}`}
      map={map}
      corridor={false}
      styleUrl={styleUrl}
      theme={theme}
      accessibilityLabel={t('routes.detail.map.label', { distance: routeKm(route.distanceM) })}
      failedMessage={t('routes.detail.map.failed')}
    />
  );
}

const styles = StyleSheet.create({
  place: { width: '100%', aspectRatio: MAP_ASPECT_RATIO },
});
