import { useLocalSearchParams } from 'expo-router';

import { MyRouteDetailScreen } from '@/features/routes/my-route-detail';

/**
 * Карточка своего маршрута (`/routes/mine/<id>`, routes-02): только вошедшим — внутри `Stack.Protected` вкладок
 * (гость по ссылке уходит на вход, RC-11); без `loader`, `generateMetadata`, OG и «Поделиться» (M3).
 */
export default function MyRouteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MyRouteDetailScreen id={String(id)} />;
}
