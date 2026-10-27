import type { RaceRouteMap } from '@pokatim/contracts';
import type { AppTheme } from '@pokatim/design-tokens';

import type { RouteMapTrack } from './track-style';

/** Общий API карты маршрута (`route-map.tsx` — native, `route-map.web.tsx` — web). */
export interface RouteMapProps {
  map: RaceRouteMap;
  /** URL стиля MapLibre из env (`mapStyleUrl`) */
  styleUrl: string;
  theme: AppTheme;
  accessibilityLabel: string;
  /** сообщение при ошибке загрузки стиля или тайлов */
  failedMessage: string;
  /**
   * routes-01: `false` — линия, старт и финиш без коридора (маршрут каталога); `map.widthM` не показывается.
   * По умолчанию `true` (карта гонки).
   */
  corridor?: boolean;
  /** свой трек участника поверх маршрута (maps-02); камера охватывает маршрут и трек */
  track?: RouteMapTrack;
}
