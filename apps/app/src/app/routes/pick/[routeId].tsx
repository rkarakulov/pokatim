import { useLocalSearchParams } from 'expo-router';

import { RouteRidePickScreen } from '@/features/route-rides/route-ride-pick';

/**
 * «Выбрать свой заезд» для маршрута (route-rides-02): только вошедшим (гард корневого layout), без таб-бара; SSR-данные,
 * мета и OG не нужны. `?mine=1` — свой маршрут (геометрия карты и ссылка «назад»).
 */
export default function RouteRidePickRoute() {
  const { routeId, mine } = useLocalSearchParams<{ routeId: string; mine?: string }>();
  return <RouteRidePickScreen routeId={String(routeId)} mine={mine === '1'} />;
}
