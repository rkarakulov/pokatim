import { AchievementFlashScreen } from '@/features/achievements/achievement-flash-screen';

/**
 * «Вспышка достижения» (achievements, A5): полноэкранный модальный экран поверх вкладок, только вошедшим (гард
 * `Stack.Protected`); открывает хост `AchievementFlashHost` корневого layout.
 */
export default function AchievementFlashRoute() {
  return <AchievementFlashScreen />;
}
