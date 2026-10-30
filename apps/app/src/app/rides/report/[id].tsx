import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RideReportScreen } from '@/features/rides/ride-report';

/** «Пожаловаться на райд» (05b) — только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function ReportRideRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <RideReportScreen id={String(id)} />;
}
