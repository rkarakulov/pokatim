import { t } from '@pokatim/i18n';
import { useTheme } from '@rkarakulov/ui';
import { Tabs } from 'expo-router/js-tabs';

import { ShellSkeleton } from '@/components/shell-skeleton';
import { TabBar } from '@/components/tab-bar';
import { isSessionPending, useSessionStore } from '@/features/auth/session-store';
import { onboardingStep, useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { useShellFailure } from '@/features/onboarding/use-shell-failure';

export default function TabsLayout() {
  const theme = useTheme();
  // сессия ещё неизвестна (SSR, восстановление при запуске) или проверить её не удалось (web: 429, сеть), онбординг
  // вошедшего ещё не выяснен (кеш, сервер): гард пускает сюда, но контент — только после входа и онбординга; вместо
  // него скелетон или ошибка с повтором — не опрос (без мигания у тех, кто уже ответил)
  const status = useSessionStore((state) => state.status);
  const step = useOnboardingStore(onboardingStep);
  const failure = useShellFailure();

  if (isSessionPending(status) || (status === 'signedIn' && step !== 'done')) {
    return <ShellSkeleton failure={failure} />;
  }

  return (
    <Tabs
      // фон сцены — цвет темы, чтобы ленивая вкладка не мигала белым в Night Ride
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.surface.default } }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="races" options={{ title: t('tabs.races') }} />
      <Tabs.Screen name="rides" options={{ title: t('tabs.rides') }} />
      <Tabs.Screen name="routes" options={{ title: t('tabs.routes') }} />
      <Tabs.Screen name="calendar" options={{ title: t('tabs.calendar') }} />
    </Tabs>
  );
}
