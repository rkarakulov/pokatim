import { useTheme } from '@rkarakulov/ui';
import { Stack } from 'expo-router';

import { ShellSkeleton } from '@/components/shell-skeleton';
import { isSessionPending, useSessionStore } from '@/features/auth/session-store';
import { onboardingStep, useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { useShellFailure } from '@/features/onboarding/use-shell-failure';

/**
 * Шаги онбординга после входа (опрос → геопозиция) — только с сессией и незавершённым шагом (гард корневого
 * layout). Пока сессия или шаг неизвестны (SSR, запуск) — скелетон оболочки, после гидрации гард ведёт на шаг или
 * прочь. Экраны не публичные: без `generateMetadata` и `loader`. Каждый экран открыт только на своём шаге.
 */
export default function SetupLayout() {
  const theme = useTheme();
  const status = useSessionStore((state) => state.status);
  const step = useOnboardingStore(onboardingStep);
  const failure = useShellFailure();

  if (isSessionPending(status) || step === 'unknown') return <ShellSkeleton failure={failure} />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.surface.default },
      }}
    >
      <Stack.Protected guard={step === 'survey'}>
        <Stack.Screen name="survey" />
      </Stack.Protected>
    </Stack>
  );
}
