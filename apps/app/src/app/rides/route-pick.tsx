import { useLocalSearchParams } from 'expo-router';

import { ShellSkeleton } from '@/components/shell-skeleton';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { RideRoutePickScreen } from '@/features/rides/ride-route-pick';

/**
 * Выбор маршрута для формы райда (05c): `?form=new` — «Новый райд», `?form=<rideId>` — правка. Только вошедшим (гард
 * корневого layout уводит гостя на вход), без таб-бара; SSR и мета не нужны. Пока сессия неизвестна (SSR, запуск) —
 * оболочка `useSettingsShell` (скелетон или ошибка с повтором), гость — скелетон до редиректа гарда: статичная часть
 * экрана («Без маршрута», «Каталог / Мои») в HTML гостю не попадает.
 */
export default function RideRoutePickRoute() {
  const { form } = useLocalSearchParams<{ form?: string }>();
  const shell = useSettingsShell();
  const signedIn = useSessionStore((state) => isSignedIn(state));
  if (shell) return shell;
  if (!signedIn) return <ShellSkeleton />;
  return <RideRoutePickScreen form={typeof form === 'string' && form ? form : 'new'} />;
}
