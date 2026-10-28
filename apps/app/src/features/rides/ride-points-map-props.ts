import type { RideMapPoint } from '@pokatim/contracts';
import type { AppTheme } from '@pokatim/design-tokens';

/** Общий API карты точек старта ленты (`ride-points-map.tsx` — native, `ride-points-map.web.tsx` — web), 05c. */
export interface RidePointsMapProps {
  points: readonly RideMapPoint[];
  /** позиция «Рядом» (уже округлённая) — точка пользователя; `null` — без точки */
  me: readonly [number, number] | null;
  /** рамка начальной камеры `[west, south, east, north]` (`pointsBounds`) */
  bounds: readonly [number, number, number, number];
  /** URL стиля MapLibre из env (`useMapStyle`) */
  styleUrl: string;
  theme: AppTheme;
  /** подпись карты для скринридера — без координат («На карте N райдов») */
  accessibilityLabel: string;
  failedMessage: string;
  /** «сейчас» — дата в карточке выбранной точки */
  now: Date;
  onOpen: (rideId: string) => void;
}
