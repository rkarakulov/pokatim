import { isSessionPending, useSessionStore } from '@/features/auth/session-store';

import { useOnboardingStore } from './onboarding-store';

const retryRestore = () => void useSessionStore.getState().hydrate();
const retryOnboarding = () => useOnboardingStore.getState().retry();

/**
 * Ошибка вместо скелетона оболочки (вкладки, шаги онбординга): сессию (web: 429, сеть) или онбординг (статус опроса)
 * проверить не удалось — «Нет соединения» / «Не удалось загрузить» с повтором. `undefined` — ещё ждём (скелетон).
 */
export function useShellFailure(): { error: unknown; retry: () => void } | undefined {
  const status = useSessionStore((state) => state.status);
  const restoreError = useSessionStore((state) => state.restoreError);
  const survey = useOnboardingStore((state) => state.survey);
  const onboardingError = useOnboardingStore((state) => state.error);

  if (status === 'unavailable') return { error: restoreError, retry: retryRestore };
  if (!isSessionPending(status) && survey === 'unavailable') {
    return { error: onboardingError, retry: retryOnboarding };
  }
  return undefined;
}
