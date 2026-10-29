import { AchievementFlashScreen } from '@/features/achievements/achievement-flash-screen';
import { useSettingsShell } from '@/features/devices/settings-shell';

/**
 * «Вспышка достижения» (achievements, A5): полноэкранный модальный экран поверх вкладок, только вошедшим (гард
 * `Stack.Protected`); открывает хост `AchievementFlashHost` корневого layout. Открыта по адресу до восстановления
 * сессии — оболочка `useSettingsShell` (скелетон; ошибка восстановления — с повтором `hydrate`), запроса достижений
 * до сессии нет.
 */
export default function AchievementFlashRoute() {
  const shell = useSettingsShell();
  return shell ?? <AchievementFlashScreen />;
}
