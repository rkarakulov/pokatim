import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { DisputeFormScreen } from '@/features/races/disputes/dispute-form';
import { groupParam } from '@/features/races/disputes/dispute-screen';

/** «Оспорить результат» (race-results-06): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function FileDisputeRoute() {
  const { id, entryId, group } = useLocalSearchParams<{
    id: string;
    entryId: string;
    group?: string;
  }>();
  const shell = useSettingsShell();
  return (
    shell ?? (
      <DisputeFormScreen raceId={String(id)} entryId={String(entryId)} group={groupParam(group)} />
    )
  );
}
