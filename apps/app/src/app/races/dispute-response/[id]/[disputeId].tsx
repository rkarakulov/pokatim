import { useLocalSearchParams } from 'expo-router';

import { DisputeResponseScreen } from '@/features/races/disputes/dispute-response';

/** «Ответ на спор» по своему результату (race-results-06): только вошедшим (гард `Stack.Protected`). */
export default function DisputeResponseRoute() {
  const { id, disputeId } = useLocalSearchParams<{ id: string; disputeId: string }>();
  return <DisputeResponseScreen raceId={String(id)} disputeId={String(disputeId)} />;
}
