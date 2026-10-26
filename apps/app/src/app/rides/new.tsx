import { RideFormScreen } from '@/features/rides/ride-form';

/** «Новый райд» — только вошедшим (гард корневого layout), без таб-бара. */
export default function NewRideRoute() {
  return <RideFormScreen />;
}
