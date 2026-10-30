import { useSettingsShell } from '@/features/devices/settings-shell';
import { RideFormScreen } from '@/features/rides/ride-form';

/** «Новый райд» — только вошедшим (гард корневого layout), без таб-бара. */
export default function NewRideRoute() {
  const shell = useSettingsShell();
  return shell ?? <RideFormScreen />;
}
