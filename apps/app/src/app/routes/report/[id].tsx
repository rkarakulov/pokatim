import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RouteReportScreen } from '@/features/routes/route-report';

/** «Пожаловаться на маршрут» райдера (routes-06, A4) — только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function ReportRouteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <RouteReportScreen id={String(id)} />;
}
