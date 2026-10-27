import { size, stroke } from '@pokatim/design-tokens';
import { nearestFraction, pointAtFraction, type Planar } from '@pokatim/tracks';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { scrubTolerance } from './scrub-line';
import type { ScrubMarkerProps } from './route-map-props';
import { useScrub } from './scrub-store';

/** testID жеста маркера — для `getByGestureTestId` в тестах. */
export const SCRUB_MARKER_PAN_TEST_ID = 'scrub-marker-pan';

const HALF = size.touchMin / 2;

/**
 * Маркер скраббинга поверх карты (native, routes-04, RC-2, RC-8): свой вид над холстом в пикселях проекции
 * линии; подписан на стор только он (карта не перерисовывается). Виден всегда (старт — доля 0), отличим от старта и
 * финиша без цвета: крупнее (`size.icon`), обводка `map.background`. Перетаскивание — жест на маркере (область
 * касания `size.touchMin`): позиция пальца → ближайшая точка линии с подсказкой текущей доли (петля не прыгает на
 * другой проход); `dragging: 'map'` — с `onBegin` (экран не прокручивается). Камера интерактивна (routes-04b): точки
 * меняются на кадр движения камеры — конфиг жеста от них не зависит (точки и допуск — из ref, M1), точка маркера
 * получает их пропсом и двигается вместе с линией. Для скринридера скрыт: без жеста то же даёт `adjustable` профиля (S4).
 */
export function ScrubMarker({ store, points, cumulative, theme }: ScrubMarkerProps) {
  // точка маркера в начале жеста: позиция пальца = она + смещение жеста (маркер под пальцем двигается)
  const origin = useRef<Planar>([0, 0]);
  // точки линии и допуск меняются на кадр камеры (routes-04b) — жест читает их из ref
  const tolerance = useMemo(() => scrubTolerance(points, cumulative), [points, cumulative]);
  const line = useRef({ points, tolerance });
  useEffect(() => {
    line.current = { points, tolerance };
  }, [points, tolerance]);
  // конфиг жеста стабилен (ни доля, ни камера его не меняют): доля — из стора через getState, точки — из ref;
  // обработчик не перерегистрируется в натив на кадр (ревью pass 1, M1)
  const config = useMemo(
    () => ({
      testID: SCRUB_MARKER_PAN_TEST_ID,
      runOnJS: true,
      onBegin: () => {
        origin.current = pointAtFraction(
          line.current.points,
          cumulative,
          store.getState().fraction,
        );
        store.setState({ dragging: 'map', active: true });
      },
      onUpdate: (event: { translationX: number; translationY: number }) => {
        const target: Planar = [
          origin.current[0] + event.translationX,
          origin.current[1] + event.translationY,
        ];
        store.setState({
          fraction: nearestFraction(
            line.current.points,
            cumulative,
            target,
            store.getState().fraction,
            line.current.tolerance,
          ),
        });
      },
      onFinalize: () => {
        if (store.getState().dragging === 'map') store.setState({ dragging: null });
      },
    }),
    [store, cumulative],
  );
  const pan = usePanGesture(config);
  return (
    <View
      style={styles.overlay}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <GestureDetector gesture={pan}>
        <MarkerDot store={store} points={points} cumulative={cumulative} theme={theme} />
      </GestureDetector>
    </View>
  );
}

/** Точка маркера: единственный подписчик доли — перерисовывается на кадр только она. */
function MarkerDot({ store, points, cumulative, theme }: ScrubMarkerProps) {
  const fraction = useScrub(store, (state) => state.fraction);
  const [x, y] = pointAtFraction(points, cumulative, fraction);
  return (
    <View
      testID="scrub-marker"
      style={[styles.hit, { transform: [{ translateX: x - HALF }, { translateY: y - HALF }] }]}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: theme.action.primary, borderColor: theme.map.background },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // касания мимо маркера проходят к карте (кнопка атрибуции «i»)
  overlay: { ...StyleSheet.absoluteFill, pointerEvents: 'box-none' },
  hit: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: size.touchMin,
    height: size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: size.icon,
    height: size.icon,
    borderRadius: size.icon / 2,
    borderWidth: stroke.indicator,
  },
});
