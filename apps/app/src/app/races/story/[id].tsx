import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction } from 'expo-router/server';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { StoryCardScreen } from '@/features/races/story/story-card-screen';
import { noindexPageMetadata } from '@/lib/page-metadata';

/** SSR: нейтральная мета без данных объекта и `noindex` (служебный экран). */
export const generateMetadata: GenerateMetadataFunction = () =>
  noindexPageMetadata(t('story.title'));

/** Карточка для сторис своего результата (story-cards): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function StoryCardRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <StoryCardScreen raceId={String(id)} />;
}
