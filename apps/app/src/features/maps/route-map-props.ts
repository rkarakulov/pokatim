import type { RaceRouteMap } from '@pokatim/contracts';
import type { AppTheme } from '@pokatim/design-tokens';
import { type ScrubStore } from '@pokatim/route-view';
import type { Planar } from '@pokatim/tracks';

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
  /**
   * routes-04d (RC-5): карта на всю область (рамка `flex: 1` вместо `MAP_ASPECT_RATIO`) — карточка маршрута со шторкой.
   * Web: колесо мыши масштабирует без Ctrl/⌘ (страница не прокручивается, RC-7). По умолчанию — пропорция 3:2.
   */
  fill?: boolean;
  /**
   * routes-04d (RC-5, RC-6): видимая высота шторки поверх карты, px — камера (`cameraPadding`) и атрибуция «i»
   * учитывают её. Обновлять в конце снапа, не на кадр перетаскивания; начальная камера — по значению при монтировании.
   */
  bottomInset?: number;
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
