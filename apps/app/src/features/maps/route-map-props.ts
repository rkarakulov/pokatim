import type { RaceRouteMap } from '@pokatim/contracts';
import type { AppTheme } from '@pokatim/design-tokens';

/** Общий API карты маршрута (`route-map.tsx` — native, `route-map.web.tsx` — web). */
export interface RouteMapProps {
  map: RaceRouteMap;
  /** URL стиля MapLibre из env (`mapStyleUrl`) */
  styleUrl: string;
  theme: AppTheme;
  accessibilityLabel: string;
  /** сообщение при ошибке загрузки стиля или тайлов */
  failedMessage: string;
}
