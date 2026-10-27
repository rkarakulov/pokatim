import { size, stroke } from '@pokatim/design-tokens';
import { nearestFraction, pointAtFraction } from '@pokatim/tracks';
import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import type { ScrubMarkerProps } from './route-map-props';
import { scrubTolerance } from './scrub-line';
import { SCRUB_MARKER_ATTR, useScrub } from './scrub-store';

const HALF = size.touchMin / 2;

/**
 * Маркер скраббинга поверх web-карты (routes-04, RC-2, RC-8): `div` в пикселях проекции линии (`map.project` после
 * `load` и на `resize`/`move` — интерактивная камера routes-04b), сдвиг — `transform`; подписан на стор только он (карта и источник не трогаются). Перетаскивание
 * — pointer events с захватом указателя, `touch-action: none` (палец не прокручивает страницу); позиция указателя →
 * ближайшая точка линии с подсказкой текущей доли. Атрибут `SCRUB_MARKER_ATTR` — касание маркера не скрывает курсор
 * профиля. Для скринридера скрыт (`aria-hidden`): без жеста то же даёт slider профиля.
 */
export function ScrubMarker({ store, points, cumulative, theme }: ScrubMarkerProps) {
  const fraction = useScrub(store, (state) => state.fraction);
  const overlay = useRef<HTMLDivElement>(null);
  const tolerance = useMemo(() => scrubTolerance(points, cumulative), [points, cumulative]);
  const [x, y] = pointAtFraction(points, cumulative, fraction);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    if ('setPointerCapture' in element) element.setPointerCapture(event.pointerId);
    store.setState({ dragging: 'map', active: true });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = overlay.current?.getBoundingClientRect();
    if (!rect || store.getState().dragging !== 'map') return;
    const target = [event.clientX - rect.left, event.clientY - rect.top] as const;
    store.setState({
      fraction: nearestFraction(points, cumulative, target, store.getState().fraction, tolerance),
    });
  };
  const release = () => {
    if (store.getState().dragging === 'map') store.setState({ dragging: null });
  };

  return (
    <div ref={overlay} aria-hidden="true" style={overlayStyle}>
      <div
        {...{ [SCRUB_MARKER_ATTR]: '' }}
        data-testid="scrub-marker"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        style={{
          ...hitStyle,
          transform: `translate(${x - HALF}px, ${y - HALF}px)`,
        }}
      >
        <div
          style={{
            ...dotStyle,
            backgroundColor: theme.action.primary,
            borderColor: theme.map.background,
          }}
        />
      </div>
    </div>
  );
}

// касания мимо маркера проходят к карте (кнопка атрибуции «i»)
const overlayStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  pointerEvents: 'none',
} as const;
const hitStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: size.touchMin,
  height: size.touchMin,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'auto',
  touchAction: 'none',
  cursor: 'grab',
} as const;
const dotStyle = {
  boxSizing: 'border-box',
  width: size.icon,
  height: size.icon,
  borderRadius: size.icon / 2,
  borderStyle: 'solid',
  borderWidth: stroke.indicator,
} as const;
