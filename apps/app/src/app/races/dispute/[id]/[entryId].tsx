import { useLocalSearchParams } from 'expo-router';

import { DisputeFormScreen } from '@/features/races/disputes/dispute-form';

/** «Оспорить результат» (race-results-06): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function FileDisputeRoute() {
  const { id, entryId } = useLocalSearchParams<{ id: string; entryId: string }>();
  return <DisputeFormScreen raceId={String(id)} entryId={String(entryId)} />;
}
