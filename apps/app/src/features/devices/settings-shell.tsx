import { ShellSkeleton } from '@/components/shell-skeleton';
import { isSessionPending, useSessionStore } from '@/features/auth/session-store';
import { onboardingStep, useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { useShellFailure } from '@/features/onboarding/use-shell-failure';

/**
 * Оболочка экранов настроек аккаунта («Устройства») под гардом корневого layout, как у вкладок: пока сессия или
 * онбординг неизвестны (SSR, запуск) — скелетон оболочки или ошибка с повтором (элемент), иначе `null` — контент.
 * Отдельного `settings/_layout` нет: dev-экспорт web называет чанки маршрутов по имени файла, второй `_layout`
 * перезаписал бы чанк корневого.
 */
export function useSettingsShell() {
  const status = useSessionStore((state) => state.status);
  const step = useOnboardingStore(onboardingStep);
  const failure = useShellFailure();
  if (isSessionPending(status) || (status === 'signedIn' && step !== 'done')) {
    return <ShellSkeleton failure={failure} />;
  }
  return null;
}
