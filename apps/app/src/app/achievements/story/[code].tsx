import { useLocalSearchParams } from 'expo-router';

import { AchievementStoryScreen } from '@/features/achievements/story/achievement-story-screen';
import { useSettingsShell } from '@/features/devices/settings-shell';

/**
 * Карточка своего достижения для сторис (ADR-0018; сезонное — `?season=<id>`): только вошедшим (гард
 * `Stack.Protected`), без таб-бара.
 */
export default function AchievementStoryRoute() {
  const { code, season } = useLocalSearchParams<{ code: string; season?: string }>();
  const shell = useSettingsShell();
  return (
    shell ?? <AchievementStoryScreen code={String(code)} season={season ? String(season) : null} />
  );
}
