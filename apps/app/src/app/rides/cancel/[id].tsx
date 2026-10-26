import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';

import { RideCancelScreen } from '@/features/rides/ride-cancel';
import { OwnRide } from '@/features/rides/ride-manage';

/** «Отменить райд» — организатору до старта (права — `me` сервера); только вошедшим, без таб-бара. */
export default function CancelRideRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <OwnRide id={String(id)} title={t('rides.cancel.title')}>
      {(ride, _reload, refreshFailure) => (
        <RideCancelScreen ride={ride} refreshFailure={refreshFailure} />
      )}
    </OwnRide>
  );
}
