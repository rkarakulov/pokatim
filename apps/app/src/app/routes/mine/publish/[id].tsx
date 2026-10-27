import { useLocalSearchParams } from 'expo-router';

import { MyRoutePublishScreen } from '@/features/routes/my-route-publish';

/**
 * Заявка своего маршрута в каталог (`/routes/mine/publish/<id>`, routes-06) — только вошедшим (гард
 * `Stack.Protected`), без таб-бара, `loader` и мета.
 */
export default function MyRoutePublishRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MyRoutePublishScreen id={String(id)} />;
}
