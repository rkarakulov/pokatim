/// <reference types="jest" />
import type * as MapLibreNative from '@maplibre/maplibre-react-native';
import type { RaceRouteMap } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { RouteMap } from './route-map';
import { SCRUB_MARKER_PAN_TEST_ID } from './scrub-marker';
import { createScrubStore, type ScrubStore } from './scrub-store';

/** RNGH v3: передача конфига обработчика в натив (эффект `useGesture` по ссылке конфига) — счётчик для M1. */
const nativeProxy = () =>
  jest.requireActual<{ NativeProxy: { setGestureHandlerConfig: (...args: unknown[]) => void } }>(
    'react-native-gesture-handler/lib/module/v3/NativeProxy',
  ).NativeProxy;

// «туда-обратно» по широте 0 (Mercator по Y вырожден — рамка по долготе): 0 → 1° → 0
const route: RaceRouteMap = {
  line: [
    [0, 0],
    [1, 0],
    [0, 0],
  ],
  start: [0, 0],
  finish: [0, 0],
  bounds: [0, 0, 1, 0],
  widthM: 50,
};
// видимая рамка: долгота 0…1 на ширине 200 px, широта −0,5…0,5 на высоте 100 px
const VIEW_BOUNDS = [0, -0.5, 1, 0.5] as const;

const element = (scrub?: ScrubStore) => (
  <GestureHandlerRootView>
    <RouteMap
      map={route}
      styleUrl="https://tiles.example/styles/positron"
      theme={themes.light}
      accessibilityLabel="Карта маршрута"
      failedMessage="Карта не загрузилась"
      corridor={false}
      scrub={scrub}
    />
  </GestureHandlerRootView>
);

/** Карта загружена, рамка и размер оверлея известны — маркер в пикселях. */
async function ready() {
  const map = await screen.findByTestId('maplibre-Map');
  await fireEvent(map, 'regionDidChange', { nativeEvent: { bounds: VIEW_BOUNDS } });
  await fireEvent(screen.getByTestId('scrub-overlay'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 100 } },
  });
}
const translate = () => {
  const style = [screen.getByTestId('scrub-marker', { includeHiddenElements: true }).props.style]
    .flat(Infinity)
    .find((part: { transform?: unknown }) => part?.transform) as {
    transform: [{ translateX: number }, { translateY: number }];
  };
  return [style.transform[0].translateX, style.transform[1].translateY];
};

describe('RouteMap native: маркер скраббинга (routes-04, RC-2)', () => {
  it('без scrub — ни оверлея, ни маркера и после событий камеры (карта гонки)', async () => {
    await render(element());
    const map = await screen.findByTestId('maplibre-Map');
    await fireEvent(map, 'regionIsChanging', { nativeEvent: { bounds: VIEW_BOUNDS } });
    await fireEvent(screen.getByTestId('map-gesture-area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 100 } },
    });
    expect(screen.queryByTestId('scrub-overlay')).toBeNull();
    expect(screen.queryByTestId('scrub-marker', { includeHiddenElements: true })).toBeNull();
  });

  it('после рамки и раскладки — маркер на старте в пикселях, скрыт от скринридера; до них маркера нет', async () => {
    await render(element(createScrubStore()));
    await screen.findByTestId('maplibre-Map');
    expect(screen.queryByTestId('scrub-marker', { includeHiddenElements: true })).toBeNull();
    await ready();
    expect(screen.queryByTestId('scrub-marker')).toBeNull();
    const [x, y] = translate();
    expect(x).toBeCloseTo(-22, 6);
    expect(y).toBeCloseTo(50 - 22, 6);
  });

  it('движение стора двигает маркер, GeoJSONSource и Map не перерисовываются', async () => {
    const lib = jest.requireMock<typeof MapLibreNative>('@maplibre/maplibre-react-native');
    const source = jest.spyOn(lib, 'GeoJSONSource');
    const mapView = jest.spyOn(lib, 'Map');
    const store = createScrubStore();
    await render(element(store));
    await ready();
    const sourceRenders = source.mock.calls.length;
    const mapRenders = mapView.mock.calls.length;
    for (const fraction of [0.1, 0.25, 0.4]) {
      await act(async () => store.setState({ fraction, active: true }));
    }
    const [x] = translate();
    expect(x).toBeCloseTo(0.8 * 200 - 22, 6);
    expect(source.mock.calls.length).toBe(sourceRenders);
    expect(mapView.mock.calls.length).toBe(mapRenders);
    source.mockRestore();
    mapView.mockRestore();
  });

  it('pan маркера: dragging «map» с onBegin, доля прилипает к линии с подсказкой (обратный проход)', async () => {
    const store = createScrubStore();
    await render(element(store));
    await ready();
    await act(async () => store.setState({ fraction: 0.9 }));
    // маркер на 0,9 → x = 0,2 × 200 = 40 px; палец сдвигается на +20 px вправо и 7 px вниз → 60 px: обратный проход
    const seen: (string | null)[] = [];
    store.subscribe((state) => seen.push(state.dragging));
    await act(async () =>
      fireGestureHandler(getByGestureTestId(SCRUB_MARKER_PAN_TEST_ID), [
        { state: State.BEGAN, translationX: 0, translationY: 0 },
        { state: State.ACTIVE, translationX: 10, translationY: 0 },
        { translationX: 20, translationY: 7 },
        { state: State.END, translationX: 20, translationY: 7 },
      ]),
    );
    expect(seen[0]).toBe('map');
    expect(store.getState().fraction).toBeCloseTo(0.85, 6);
    expect(store.getState()).toMatchObject({ dragging: null, active: true });
  });

  it('M1: движение маркера по стору не перенастраивает жест маркера в натив', async () => {
    const setConfig = jest.spyOn(nativeProxy(), 'setGestureHandlerConfig');
    const store = createScrubStore();
    await render(element(store));
    await ready();
    const before = setConfig.mock.calls.length;
    // шпион на том же экземпляре RNGH, что и компонент (иначе тест — тавтология)
    expect(before).toBeGreaterThan(0);
    for (const fraction of [0.1, 0.2, 0.3]) {
      await act(async () => store.setState({ fraction }));
    }
    expect(translate()[0]).toBeCloseTo(0.6 * 200 - 22, 6);
    expect(setConfig.mock.calls.length).toBe(before);
    setConfig.mockRestore();
  });

  it('routes-04b (I4, RC-4): движение камеры (regionIsChanging) — маркер на линии, Map и GeoJSONSource не перерисовываются', async () => {
    const lib = jest.requireMock<typeof MapLibreNative>('@maplibre/maplibre-react-native');
    const source = jest.spyOn(lib, 'GeoJSONSource');
    const mapView = jest.spyOn(lib, 'Map');
    const store = createScrubStore();
    await render(element(store));
    await ready();
    await act(async () => store.setState({ fraction: 0.5 }));
    const sourceRenders = source.mock.calls.length;
    const mapRenders = mapView.mock.calls.length;
    const map = screen.getByTestId('maplibre-Map');
    // приближение вдвое вокруг центра: долгота 0,25…0,75 на 200 px — разворот (1°) за правым краем
    await fireEvent(map, 'regionIsChanging', {
      nativeEvent: { bounds: [0.25, -0.25, 0.75, 0.25] },
    });
    expect(translate()[0]).toBeCloseTo(1.5 * 200 - 22, 6);
    // сдвиг: долгота 0,5…1,5 — разворот на трети ширины
    await fireEvent(map, 'regionDidChange', { nativeEvent: { bounds: [0.5, -0.5, 1.5, 0.5] } });
    expect(translate()[0]).toBeCloseTo(0.5 * 200 - 22, 6);
    expect(source.mock.calls.length).toBe(sourceRenders);
    expect(mapView.mock.calls.length).toBe(mapRenders);
    source.mockRestore();
    mapView.mockRestore();
  });

  it('routes-04b (M1): движение камеры не перенастраивает жест маркера; перетаскивание — по новым точкам', async () => {
    const setConfig = jest.spyOn(nativeProxy(), 'setGestureHandlerConfig');
    const store = createScrubStore();
    await render(element(store));
    await ready();
    const before = setConfig.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    const map = screen.getByTestId('maplibre-Map');
    for (const west of [0.1, 0.2, 0.5]) {
      await fireEvent(map, 'regionIsChanging', {
        nativeEvent: { bounds: [west, -0.5, west + 1, 0.5] },
      });
    }
    expect(setConfig.mock.calls.length).toBe(before);
    setConfig.mockRestore();
    // вид: долгота 0,5…1,5 на 200 px; маркер на старте (x = −100 px); палец +150 px → x = 50 px — долгота 0,75:
    // ближайшая точка первого прохода — доля 0,375
    await act(async () =>
      fireGestureHandler(getByGestureTestId(SCRUB_MARKER_PAN_TEST_ID), [
        { state: State.BEGAN, translationX: 0, translationY: 0 },
        { state: State.ACTIVE, translationX: 10, translationY: 0 },
        { translationX: 150, translationY: 0 },
        { state: State.END, translationX: 150, translationY: 0 },
      ]),
    );
    expect(store.getState().fraction).toBeCloseTo(0.375, 6);
  });
});
