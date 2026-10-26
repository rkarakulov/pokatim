import { useLocalSearchParams } from 'expo-router';

import { RideReportScreen } from '@/features/rides/ride-report';

/** «Пожаловаться на райд» (05b) — только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function ReportRideRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RideReportScreen id={String(id)} />;
}
