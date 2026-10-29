import { useLocalSearchParams } from 'expo-router';

import { AchievementScreen } from '@/features/achievements/achievement-screen';

/** Своё достижение (`/achievements/<code>`, achievements): вход — блок «Достижения» профиля; только вошедшим. */
export default function AchievementRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <AchievementScreen code={String(code)} />;
}
