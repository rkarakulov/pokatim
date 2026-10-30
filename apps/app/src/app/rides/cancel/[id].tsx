import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RideCancelScreen } from '@/features/rides/ride-cancel';
import { OwnRide } from '@/features/rides/ride-manage';

/** «Отменить райд» — организатору до старта (права — `me` сервера); только вошедшим, без таб-бара. */
export default function CancelRideRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return (
    shell ?? (
      <OwnRide id={String(id)} title={t('rides.cancel.title')}>
        {(ride, _reload, refreshFailure) => (
          <RideCancelScreen ride={ride} refreshFailure={refreshFailure} />
        )}
      </OwnRide>
    )
  );
}
