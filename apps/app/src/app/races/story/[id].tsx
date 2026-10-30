import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { StoryCardScreen } from '@/features/races/story/story-card-screen';

/** Карточка для сторис своего результата (story-cards): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function StoryCardRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <StoryCardScreen raceId={String(id)} />;
}
