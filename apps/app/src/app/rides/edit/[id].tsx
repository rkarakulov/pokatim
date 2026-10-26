import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';

import { RideFormScreen } from '@/features/rides/ride-form';
import { OwnRide } from '@/features/rides/ride-manage';

/** «Изменить райд» — организатору до старта (права — `me` сервера); только вошедшим, без таб-бара. */
export default function EditRideRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <OwnRide id={String(id)} title={t('rides.form.editTitle')}>
      {(ride, reload) => <RideFormScreen ride={ride} onReload={reload} />}
    </OwnRide>
  );
}
