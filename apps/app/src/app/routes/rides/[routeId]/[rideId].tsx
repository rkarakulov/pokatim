import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RouteRideScreen } from '@/features/route-rides/route-ride-detail';

/**
 * «Заезд по маршруту» (route-rides-02): результат проверки своего заезда — только вошедшим (гард корневого layout),
 * без SSR-данных, мета и OG. `?mine=1` — свой маршрут (геометрия карты и ссылка «К маршруту»).
 */
export default function RouteRideRoute() {
  const { routeId, rideId, mine } = useLocalSearchParams<{
    routeId: string;
    rideId: string;
    mine?: string;
  }>();
  const shell = useSettingsShell();
  return (
    shell ?? (
      <RouteRideScreen routeId={String(routeId)} rideId={String(rideId)} mine={mine === '1'} />
    )
  );
}
