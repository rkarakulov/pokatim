import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RouteRideOthersScreen } from '@/features/route-rides/route-ride-others';

/**
 * Полный список «Другие на маршруте» (route-rides-04): только вошедшим (гард корневого layout), без таб-бара; SSR-данные,
 * мета и OG не нужны.
 */
export default function RouteRideOthersRoute() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const shell = useSettingsShell();
  return shell ?? <RouteRideOthersScreen routeId={String(routeId)} />;
}
