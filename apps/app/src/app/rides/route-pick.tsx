import { useLocalSearchParams } from 'expo-router';

import { RideRoutePickScreen } from '@/features/rides/ride-route-pick';

/**
 * Выбор маршрута для формы райда (05c): `?form=new` — «Новый райд», `?form=<rideId>` — правка. Только вошедшим (гард
 * корневого layout), без таб-бара; SSR и мета не нужны.
 */
export default function RideRoutePickRoute() {
  const { form } = useLocalSearchParams<{ form?: string }>();
  return <RideRoutePickScreen form={typeof form === 'string' && form ? form : 'new'} />;
}
