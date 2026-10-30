import { useLocalSearchParams } from 'expo-router';

import { useSettingsShell } from '@/features/devices/settings-shell';
import { MyRoutePublishScreen } from '@/features/routes/my-route-publish';

/**
 * Заявка своего маршрута в каталог (`/routes/mine/publish/<id>`, routes-06) — только вошедшим (гард
 * `Stack.Protected`), без таб-бара, `loader` и мета.
 */
export default function MyRoutePublishRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shell = useSettingsShell();
  return shell ?? <MyRoutePublishScreen id={String(id)} />;
}
