import { useLocalSearchParams } from 'expo-router';

import { RideInviteScreen } from '@/features/rides/invite/ride-invite-screen';

/** Карточка-приглашение кофе-райда (ADR-0018): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function RideInviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RideInviteScreen rideId={String(id)} />;
}
