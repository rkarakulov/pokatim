import { t } from '@pokatim/i18n';
import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { RideFormScreen } from '@/features/rides/ride-form';
import { OwnRide } from '@/features/rides/ride-manage';

/** «Изменить райд» — организатору до старта (права — `me` сервера); только вошедшим, без таб-бара. */
export default function EditRideRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return (
    shell ?? (
      <OwnRide id={String(id)} title={t('rides.form.editTitle')}>
        {(ride, reload, refreshFailure) => (
          <RideFormScreen ride={ride} onReload={reload} refreshFailure={refreshFailure} />
        )}
      </OwnRide>
    )
  );
}
