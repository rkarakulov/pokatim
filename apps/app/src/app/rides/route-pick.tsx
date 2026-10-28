import { useLocalSearchParams } from 'expo-router';

import { ShellSkeleton } from '@/components/shell-skeleton';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { RideRoutePickScreen } from '@/features/rides/ride-route-pick';

/**
 * Выбор маршрута для формы райда (05c): `?form=new` — «Новый райд», `?form=<rideId>` — правка. Только вошедшим (гард
 * корневого layout уводит гостя на вход), без таб-бара; SSR и мета не нужны. Пока сессия неизвестна (SSR, запуск) или
 * зритель не вошёл — скелетон оболочки: статичная часть экрана («Без маршрута», «Каталог / Мои») в HTML гостю не
 * попадает.
 */
export default function RideRoutePickRoute() {
  const { form } = useLocalSearchParams<{ form?: string }>();
  const signedIn = useSessionStore((state) => isSignedIn(state));
  if (!signedIn) return <ShellSkeleton />;
  return <RideRoutePickScreen form={typeof form === 'string' && form ? form : 'new'} />;
}
