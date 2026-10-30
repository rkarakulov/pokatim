import { useLocalSearchParams } from 'expo-router';

import { RouteStoryScreen } from '@/features/routes/story/route-story-screen';

/** Карточка маршрута каталога для сторис (ADR-0018): только вошедшим (гард `Stack.Protected`), без таб-бара. */
export default function RouteStoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RouteStoryScreen routeId={String(id)} />;
}
