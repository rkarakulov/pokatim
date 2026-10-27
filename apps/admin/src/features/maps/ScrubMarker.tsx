import {
  type MapViewStore,
  SCRUB_MARKER_ATTR,
  type ScrubStore,
  scrubTolerance,
} from '@pokatim/route-view';
import { nearestFraction, pointAtFraction, type Planar } from '@pokatim/tracks';
import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from 'zustand';

/**
 * Маркер скраббинга поверх карты панели (routes-05, A3; по образцу web приложения routes-04): `div` в пикселях
 * проекции линии, сдвиг — `transform`; подписан на стор скраббинга только он. Перетаскивание — pointer events с
 * захватом указателя: позиция указателя → ближайшая точка линии с подсказкой текущей доли. Атрибут
 * `SCRUB_MARKER_ATTR` — касание маркера не скрывает курсор профиля. Для скринридера скрыт: то же даёт slider профиля.
 */
export function ScrubMarker({
  store,
  points,
  cumulative,
}: {
  store: ScrubStore;
  points: readonly Planar[];
  cumulative: readonly number[];
}) {
  const fraction = useStore(store, (state) => state.fraction);
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
    <div ref={overlay} className="route-map__overlay" aria-hidden="true">
      <div
        {...{ [SCRUB_MARKER_ATTR]: '' }}
        className="scrub-marker"
        data-testid="scrub-marker"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        // позиция — данные кадра камеры (пиксели проекции), не оформление
        style={{ transform: `translate(${x}px, ${y}px)` }}
      >
        <span className="scrub-marker__dot" />
      </div>
    </div>
  );
}

/**
 * Слой маркера (routes-04b, RC-4): единственный подписчик пикселей линии в сторе вида — на движение камеры
 * перерисовывается он и маркер, не карта. Пикселей ещё нет — маркера нет.
 */
export function ScrubLayer({
  view,
  store,
  cumulative,
}: {
  view: MapViewStore;
  store: ScrubStore;
  cumulative: readonly number[];
}) {
  const points = useStore(view, (state) => state.points);
  return points ? <ScrubMarker store={store} points={points} cumulative={cumulative} /> : null;
}
