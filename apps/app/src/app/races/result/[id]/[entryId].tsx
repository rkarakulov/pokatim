import { useLocalSearchParams } from 'expo-router';

import { RivalCardScreen } from '@/features/races/disputes/rival-card';

/** Карточка соперника (race-results-06, RC-14): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function RivalResultRoute() {
  const { id, entryId } = useLocalSearchParams<{ id: string; entryId: string }>();
  return <RivalCardScreen raceId={String(id)} entryId={String(entryId)} />;
}
