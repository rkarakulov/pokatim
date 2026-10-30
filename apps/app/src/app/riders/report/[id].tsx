import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RiderReportScreen } from '@/features/riders/rider-report';

/** «Пожаловаться на профиль» райдера (profile-report-app) — только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function ReportRiderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <RiderReportScreen id={String(id)} />;
}
