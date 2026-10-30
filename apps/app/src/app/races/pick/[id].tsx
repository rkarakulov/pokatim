import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RacePickScreen } from '@/features/races/race-pick';

/** «Выбрать свой заезд» в гонку: только вошедшим (гард вкладок корневого layout), без таб-бара; SSR и мета не нужны. */
export default function RacePickRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <RacePickScreen id={String(id)} />;
}
