import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction } from 'expo-router/server';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RideInviteScreen } from '@/features/rides/invite/ride-invite-screen';
import { noindexPageMetadata } from '@/lib/page-metadata';

/** SSR: нейтральная мета без данных объекта и `noindex` (служебный экран). */
export const generateMetadata: GenerateMetadataFunction = () =>
  noindexPageMetadata(t('rideInvite.title'));

/** Карточка-приглашение кофе-райда (ADR-0018): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function RideInviteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <RideInviteScreen rideId={String(id)} />;
}
