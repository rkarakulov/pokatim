import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';
import type { GenerateMetadataFunction } from 'expo-router/server';

import { AchievementStoryScreen } from '@/features/achievements/story/achievement-story-screen';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { noindexPageMetadata } from '@/lib/page-metadata';

/** SSR: нейтральная мета без данных объекта и `noindex` (служебный экран). */
export const generateMetadata: GenerateMetadataFunction = () =>
  noindexPageMetadata(t('achievementCard.title'));

/** Карточка своего достижения для сторис (ADR-0018): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function AchievementStoryRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const shell = useSettingsShell();
  return shell ?? <AchievementStoryScreen code={String(code)} />;
}
