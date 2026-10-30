import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RideInviteScreen } from '@/features/rides/invite/ride-invite-screen';

/** Карточка-приглашение кофе-райда (ADR-0018): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function RideInviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <RideInviteScreen rideId={String(id)} />;
}
