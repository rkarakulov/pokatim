import type { RaceRouteMap } from '@pokatim/contracts';
import type { AppTheme } from '@pokatim/design-tokens';
import type { Planar } from '@pokatim/tracks';

import type { ScrubStore } from './scrub-store';
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
  /** routes-03: толщина осевой линии маршрута, px; по умолчанию `stroke.indicator` (карта гонки) */
  lineWidth?: number;
  /** свой трек участника поверх маршрута (maps-02); камера охватывает маршрут и трек */
  track?: RouteMapTrack;
  /**
   * routes-04: стор скраббинга экрана — маркер на линии показа (виден всегда, перетаскивается, синхронен с профилем).
   * Домен — доля длины линии, карта о профиле не знает. Нет — маркера нет (карта гонки).
   */
  scrub?: ScrubStore;
}

/** Маркер скраббинга (`scrub-marker.tsx` — native, `scrub-marker.web.tsx` — web). */
export interface ScrubMarkerProps {
  store: ScrubStore;
  /** вершины линии показа в пикселях оверлея */
  points: readonly Planar[];
  /** накопленная длина тех же вершин, м (`cumulativeMeters`) */
  cumulative: readonly number[];
  theme: AppTheme;
}
