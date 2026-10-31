import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction } from 'expo-router/server';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RouteStoryScreen } from '@/features/routes/story/route-story-screen';
import { noindexPageMetadata } from '@/lib/page-metadata';

/** SSR: нейтральная мета без данных объекта и `noindex` (служебный экран). */
export const generateMetadata: GenerateMetadataFunction = () =>
  noindexPageMetadata(t('routeCard.title'));

/** Карточка маршрута каталога для сторис (ADR-0018): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function RouteStoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <RouteStoryScreen routeId={String(id)} />;
}
