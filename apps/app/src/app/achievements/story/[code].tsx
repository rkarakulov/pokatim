import { useLocalSearchParams } from 'expo-router';

import { AchievementStoryScreen } from '@/features/achievements/story/achievement-story-screen';

/** Карточка своего достижения для сторис (ADR-0018): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function AchievementStoryRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <AchievementStoryScreen code={String(code)} />;
}
