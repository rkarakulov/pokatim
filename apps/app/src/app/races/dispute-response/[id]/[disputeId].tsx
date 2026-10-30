import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { DisputeResponseScreen } from '@/features/races/disputes/dispute-response';

/** «Ответ на спор» по своему результату (race-results-06): только вошедшим (гард `Stack.Protected`). */
export default function DisputeResponseRoute() {
  const { id, disputeId } = useLocalSearchParams<{ id: string; disputeId: string }>();
  const shell = useSettingsShell();
  return shell ?? <DisputeResponseScreen raceId={String(id)} disputeId={String(disputeId)} />;
}
