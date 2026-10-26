import type { RaceDetail } from '@pokatim/contracts';
import { themes, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SkeletonGroup, useTheme } from '@rkarakulov/ui';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { MAP_ASPECT_RATIO } from '@/features/maps/corridor-style';
import { mapStyleUrl } from '@/features/maps/map-style';
import { mapSupported } from '@/features/maps/map-support';
import { RouteMap } from '@/features/maps/route-map';
import { formatDistances } from '@/lib/minsk-format';
import { useMounted } from '@/lib/use-minsk-clock';

import { useRaceRoute } from './queries';

/**
 * Карта маршрута с коридором на карточке гонки (maps-01, ADR-0014). Без коридора — ничего. SSR и первый клиентский
 * рендер — место карты (скелетон той же пропорции, RC-2): env стиля и геометрия известны только после монтирования.
 * Затем: env не задан, нативного модуля карты нет, геометрия 404 или ошибка — блок схлопывается (строки «Коридор» и дистанция остаются);
 * иначе — карта по теме приложения.
 */
export function RaceRouteMap({ race }: { race: RaceDetail }) {
  const theme = useTheme<AppTheme>();
  const mounted = useMounted();
  const corridor = race.corridor ?? null;
  // нет нативного модуля (Expo Go, старый dev-клиент) — как env не задан
  const styleUrl = mounted && mapSupported() ? mapStyleUrl(theme === themes.dark) : null;
  const route = useRaceRoute(race.id, Boolean(corridor) && styleUrl !== null);
  const widthM = corridor?.widthM;
  // ширина коридора на карте — из карточки, как в строке «Коридор» и подписи (один источник после правки гонки)
  const map = useMemo(
    () => (route.data && widthM !== undefined ? { ...route.data, widthM } : null),
    [route.data, widthM],
  );

  if (!corridor) return null;
  // ошибка без данных — блока нет; ошибка обновления при показанной карте — карта остаётся (§4.12)
  if (mounted && (styleUrl === null || (route.isError && !route.data))) return null;
  if (!map || styleUrl === null) {
    return (
      <SkeletonGroup>
        <View style={[styles.place, { backgroundColor: theme.surface.skeleton }]} />
      </SkeletonGroup>
    );
  }
  return (
    <RouteMap
      // смена стиля (темы) — новая карта: сброс ошибки прошлого стиля
      key={styleUrl}
      map={map}
      styleUrl={styleUrl}
      theme={theme}
      accessibilityLabel={t('races.detail.map.label', {
        distance: formatDistances([race.distanceKm]) ?? '',
        width: corridor.widthM,
      })}
      failedMessage={t('races.detail.map.failed')}
    />
  );
}

const styles = StyleSheet.create({
  place: { width: '100%', aspectRatio: MAP_ASPECT_RATIO },
});
