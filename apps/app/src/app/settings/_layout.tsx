import { useTheme } from '@rkarakulov/ui';
import { Stack } from 'expo-router';

import { ShellSkeleton } from '@/components/shell-skeleton';
import { isSessionPending, useSessionStore } from '@/features/auth/session-store';
import { onboardingStep, useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { useShellFailure } from '@/features/onboarding/use-shell-failure';

/**
 * Настройки аккаунта («Устройства») — под тем же гардом корневого layout, что и вкладки. Пока сессия или онбординг
 * неизвестны (SSR, запуск) — скелетон оболочки или ошибка с повтором, контент — только вошедшему с пройденным
 * онбордингом. Экраны не публичные: без `generateMetadata` и `loader`.
 */
export default function SettingsLayout() {
  const theme = useTheme();
  const status = useSessionStore((state) => state.status);
  const step = useOnboardingStore(onboardingStep);
  const failure = useShellFailure();

  if (isSessionPending(status) || (status === 'signedIn' && step !== 'done')) {
    return <ShellSkeleton failure={failure} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.surface.default },
      }}
    />
  );
}
