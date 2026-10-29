import { useLocalSearchParams } from 'expo-router';

import { AchievementScreen } from '@/features/achievements/achievement-screen';
import { useSettingsShell } from '@/features/devices/settings-shell';

/**
 * Своё достижение (`/achievements/<code>`, achievements): вход — блок «Достижения» профиля; только вошедшим. Оболочка —
 * как у `/profile` (`useSettingsShell`): до восстановления сессии — скелетон или ошибка с повтором, без запроса.
 */
export default function AchievementRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const shell = useSettingsShell();
  return shell ?? <AchievementScreen code={String(code)} />;
}
