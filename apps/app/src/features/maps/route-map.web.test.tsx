/// <reference types="jest" />
import type { RaceRouteMap } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { AccessibilityInfo } from 'react-native';

import { CORRIDOR_OPACITY, MAP_FIT_PADDING, ROUTE_SOURCE_ID } from './corridor-style';
import type * as Position from '@/features/location/current-position';

import type * as Loader from './load-maplibre';
import { LOCATE_ZOOM, LOCATION_SOURCE_ID } from './location-style';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './map-camera';
import { WHEEL_HINT_MS } from './map-wheel.web';
import { RouteMap } from './route-map';

interface MockMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void>;
  addSource: jest.Mock;
  addLayer: jest.Mock;
  remove: jest.Mock;
  zoomIn: jest.Mock;
  zoomOut: jest.Mock;
  fitBounds: jest.Mock;
  easeTo: jest.Mock;
  setPadding: jest.Mock;
  addControl: jest.Mock;
  getSource: jest.Mock;
  touchZoomRotate: { disableRotation: jest.Mock };
  keyboard: { disableRotation: jest.Mock };
}

// jsdom без WebGL: `maplibre-gl` подменён в точке загрузки (`load-maplibre`): фабрика — только при вызове
jest.mock('./load-maplibre', () => ({ loadMaplibre: jest.fn() }));
// routes-04d: чтение позиции — мок модуля (Geolocation — отдельный тест current-position.web)
jest.mock('@/features/location/current-position', () => ({ readCurrentPosition: jest.fn() }));
const readPosition = jest.mocked(
  jest.requireMock<typeof Position>('@/features/location/current-position').readCurrentPosition,
);

const state = { maps: [] as MockMap[], workerUrl: '' };
class FakeAttributionControl {
  constructor(readonly options: unknown) {}
}
class FakeMap implements MockMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void> = {};
  addSource = jest.fn();
  addLayer = jest.fn();
  remove = jest.fn();
  zoomIn = jest.fn();
  zoomOut = jest.fn();
  fitBounds = jest.fn();
  easeTo = jest.fn();
  setPadding = jest.fn();
  addControl = jest.fn();
  // источник точки позиции: после addSource — с setData
  sources = new Map<string, { setData: jest.Mock }>();
  getSource = jest.fn((id: string) => this.sources.get(id));
  touchZoomRotate = { disableRotation: jest.fn() };
  keyboard = { disableRotation: jest.fn() };
  constructor(options: Record<string, unknown>) {
    this.options = options;
    state.maps.push(this);
    this.addSource.mockImplementation((id: string) => {
      this.sources.set(id, { setData: jest.fn() });
    });
  }
  on(event: string, handler: () => void) {
    this.handlers[event] = handler;
    return this;
  }
}
const loadMaplibre = jest.mocked(jest.requireMock<typeof Loader>('./load-maplibre').loadMaplibre);

beforeEach(() => {
  readPosition.mockReset();
  state.maps = [];
  state.workerUrl = '';
  loadMaplibre.mockReset();
  loadMaplibre.mockImplementation(
    async () =>
      // мок модуля: только то, что зовёт карта
      ({
        Map: FakeMap,
        AttributionControl: FakeAttributionControl,
        getVersion: () => '6.16.0',
        setWorkerUrl: (url: string) => {
          state.workerUrl = url;
        },
      }) as unknown as Awaited<ReturnType<typeof Loader.loadMaplibre>>,
  );
});

const route: RaceRouteMap = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
  widthM: 50,
};
const LIGHT = 'https://tiles.example/styles/positron';
const DARK = 'https://tiles.example/styles/dark';

const props = (styleUrl = LIGHT) => ({
  map: route,
  styleUrl,
  theme: themes.light,
  accessibilityLabel: 'Карта маршрута',
  failedMessage: 'Карта не загрузилась',
});

// react-native-web в настоящем DOM (jsdom): карте нужен узел-контейнер, рендерер RNTL его не даёт
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement;
async function render(element: ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => created.render(element));
  return {
    rerender: (next: ReactNode) => act(async () => created.render(next)),
    unmount: () => act(async () => created.unmount()),
  };
}
const text = () => host.textContent ?? '';

/** Дождаться промиса динамического `import()` и эффекта. */
const flush = () => act(async () => {});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('RouteMap (web, maplibre-gl)', () => {
  it('серверный рендер: место карты с подписью, maplibre-gl не загружен', () => {
    const html = renderToString(<RouteMap {...props()} />);
    expect(html).toContain('Карта маршрута');
    expect(html).toContain('route-map-canvas');
    expect(loadMaplibre).not.toHaveBeenCalled();
  });

  it('после монтирования: карта по рамке без анимации, компактная атрибуция, слои после load', async () => {
    await render(<RouteMap {...props()} />);
    await flush();
    expect(state.maps).toHaveLength(1);
    const [map] = state.maps;
    expect(map!.options).toMatchObject({
      style: LIGHT,
      attributionControl: false,
      bounds: route.bounds,
      fitBoundsOptions: { padding: MAP_FIT_PADDING, animate: false },
    });
    // routes-04d (RC-6): компактная атрибуция — слева внизу
    expect(map!.addControl).toHaveBeenCalledWith(
      new FakeAttributionControl({ compact: true }),
      'bottom-left',
    );
    expect(state.workerUrl).toBe('/maplibre-gl-worker.mjs?v=6.16.0');
    expect(map!.addLayer).not.toHaveBeenCalled();
    await act(async () => map!.handlers.load!());
    expect(map!.addSource).toHaveBeenCalledWith(
      ROUTE_SOURCE_ID,
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(map!.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual([
      'corridor',
      'route',
      'start',
      'finish',
    ]);
    expect(map!.addLayer.mock.calls[0]![0].paint['line-opacity']).toBe(CORRIDOR_OPACITY);
    expect(text()).not.toContain('Карта не загрузилась');
  });

  it('ошибка стиля или тайлов — сообщение поверх карты', async () => {
    await render(<RouteMap {...props()} />);
    await flush();
    const map = state.maps.at(-1)!;
    expect(text()).not.toContain('Карта не загрузилась');
    await act(async () => map.handlers.error!());
    expect(text()).toContain('Карта не загрузилась');
  });

  it('смена стиля (темы) — карта пересоздаётся; размонтирование — remove()', async () => {
    const view = await render(<RouteMap {...props()} />);
    await flush();
    const before = state.maps.length;
    const first = state.maps.at(-1)!;
    await view.rerender(<RouteMap {...props(DARK)} />);
    await flush();
    expect(state.maps).toHaveLength(before + 1);
    expect(first.remove).toHaveBeenCalled();
    const second = state.maps.at(-1)!;
    expect(second.options.style).toBe(DARK);
    await view.unmount();
    root = null;
    expect(second.remove).toHaveBeenCalled();
  });
});

describe('RouteMap (web): свой трек (maps-02)', () => {
  const track = {
    line: [
      [27.45, 53.85],
      [27.55, 53.9],
      [27.65, 54.05],
    ] as [number, number][],
    segment: { from: 0.5, to: 1.5 },
    offRuns: [{ from: 1, to: 1.2 }],
  };

  it('без track — источник и слои maps-01 без изменений (AC9)', async () => {
    await render(<RouteMap {...props()} />);
    await flush();
    const map = state.maps.at(-1)!;
    await act(async () => map.handlers.load!());
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addLayer.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect(map.options.bounds).toEqual(route.bounds);
  });

  it('с track — второй источник, слои трека перед start; рамка охватывает маршрут и трек', async () => {
    await render(<RouteMap {...props()} track={track} />);
    await flush();
    const map = state.maps.at(-1)!;
    expect(map.options.bounds).toEqual([27.45, 53.8, 27.65, 54.05]);
    await act(async () => map.handlers.load!());
    expect(map.addSource).toHaveBeenLastCalledWith(
      'my-track',
      expect.objectContaining({ type: 'geojson' }),
    );
    const trackCalls = map.addLayer.mock.calls.filter(([layer]) => layer.source === 'my-track');
    expect(trackCalls.map(([layer, before]) => [layer.id, before])).toEqual([
      ['track-outside', 'start'],
      ['track', 'start'],
      ['track-off', 'start'],
    ]);
  });
});

describe('RouteMap (web): атрибуция и отступы (B2, B4 maps-02)', () => {
  it('атрибуция сворачивается после обновлений стиля и источников; цвета — по теме в области карты; отступ снизу под «i»', async () => {
    await render(<RouteMap {...props(DARK)} theme={themes.dark} />);
    await flush();
    const map = state.maps.at(-1)!;
    expect(map.handlers.styledata).toBeDefined();
    expect(map.handlers.sourcedata).toBeDefined();
    const canvas = host.querySelector<HTMLElement>('[data-testid="route-map-canvas"]')!;
    const scope = canvas.dataset.routeMap!;
    const css = host.querySelector('style')!.textContent!;
    expect(css).toContain(`[data-route-map="${scope}"] .maplibregl-ctrl.maplibregl-ctrl-attrib`);
    expect(css).toContain(themes.dark.surface.raised);
    expect(MAP_FIT_PADDING.bottom).toBeGreaterThan(MAP_FIT_PADDING.top);
  });
});

describe('RouteMap (web): интерактивная карта (routes-04b, RC-1, RC-9)', () => {
  it('routes-04c: без кооперативного режима (один палец и мышь двигают карту), без вращения и наклона, зум 2–17', async () => {
    await render(<RouteMap {...props()} />);
    await flush();
    const map = state.maps.at(-1)!;
    expect(map.options).toMatchObject({
      interactive: true,
      cooperativeGestures: false,
      dragPan: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      locale: { 'Map.Title': 'Карта: стрелки — сдвиг, плюс и минус — масштаб' },
    });
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled();
    expect(map.keyboard.disableRotation).toHaveBeenCalled();
  });

  describe('колесо мыши (routes-04c): зум только с Ctrl/⌘, без модификатора — прокрутка страницы', () => {
    const HINT = 'Чтобы изменить масштаб, крутите колесо с Ctrl';
    /** Узел внутри контейнера карты — как холст maplibre-gl, где слушает колесо `scrollZoom`. */
    async function mapWithWheelSpy() {
      await render(<RouteMap {...props()} />);
      await flush();
      const canvas = host.querySelector<HTMLElement>('[data-testid="route-map-canvas"]')!;
      const inner = document.createElement('div');
      canvas.append(inner);
      const scrollZoom = jest.fn();
      inner.addEventListener('wheel', scrollZoom);
      const wheel = (init: WheelEventInit = {}) => {
        const event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 100,
          ...init,
        });
        act(() => {
          inner.dispatchEvent(event);
        });
        return event;
      };
      return { scrollZoom, wheel };
    }

    it('без модификатора: до зума карты не доходит, прокрутка страницы не отменена, подсказка', async () => {
      const { scrollZoom, wheel } = await mapWithWheelSpy();
      expect(text()).not.toContain(HINT);
      const event = wheel();
      expect(scrollZoom).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(text()).toContain(HINT);
    });

    it.each([['ctrlKey'], ['metaKey']])(
      'с %s — зум карты (scrollZoom maplibre-gl), подсказки нет',
      async (key) => {
        const { scrollZoom, wheel } = await mapWithWheelSpy();
        wheel({ [key]: true });
        expect(scrollZoom).toHaveBeenCalledTimes(1);
        expect(text()).not.toContain(HINT);
      },
    );

    it('подсказка гаснет сама; размонтирование снимает обработчик', async () => {
      jest.useFakeTimers();
      try {
        const { scrollZoom, wheel } = await mapWithWheelSpy();
        wheel();
        expect(text()).toContain(HINT);
        act(() => {
          jest.advanceTimersByTime(WHEEL_HINT_MS);
        });
        expect(text()).not.toContain(HINT);
        const canvas = host.querySelector<HTMLElement>('[data-testid="route-map-canvas"]')!;
        await act(async () => root?.unmount());
        root = null;
        const inner = document.createElement('div');
        canvas.append(inner);
        inner.addEventListener('wheel', scrollZoom);
        inner.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
        expect(scrollZoom).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('серверный рендер (карты ещё нет) — кнопок нет', () => {
    expect(renderToString(<RouteMap {...props()} />)).not.toContain('map-zoom-in');
  });

  const button = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

  it('кнопки «+», «−», «в рамку» — методы карты с анимацией; reduce motion — без анимации', async () => {
    const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
    reduce.mockResolvedValue(false);
    const track = {
      line: [
        [27.45, 53.85],
        [27.65, 54.05],
      ] as [number, number][],
      segment: { from: 0, to: 1 },
      offRuns: [],
    };
    await render(<RouteMap {...props()} track={track} />);
    await flush();
    const map = state.maps.at(-1)!;
    await act(async () => button('map-zoom-in').click());
    expect(map.zoomIn).toHaveBeenLastCalledWith({ animate: true });
    await act(async () => button('map-zoom-out').click());
    expect(map.zoomOut).toHaveBeenLastCalledWith({ animate: true });
    await act(async () => button('map-fit').click());
    expect(map.fitBounds).toHaveBeenLastCalledWith([27.45, 53.8, 27.65, 54.05], {
      padding: MAP_FIT_PADDING,
      animate: true,
    });
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';

    reduce.mockResolvedValue(true);
    await render(<RouteMap {...props()} />);
    await flush();
    const reduced = state.maps.at(-1)!;
    await act(async () => button('map-zoom-in').click());
    expect(reduced.zoomIn).toHaveBeenLastCalledWith({ animate: false });
    await act(async () => button('map-fit').click());
    expect(reduced.fitBounds).toHaveBeenLastCalledWith(route.bounds, {
      padding: MAP_FIT_PADDING,
      animate: false,
    });
    reduce.mockRestore();
  });

  it('ревью pass 1 (M2): ошибка тайла после load — карта и кнопки остаются, сообщения нет', async () => {
    await render(<RouteMap {...props()} />);
    await flush();
    const map = state.maps.at(-1)!;
    await act(async () => map.handlers.load!());
    await act(async () => map.handlers.error!());
    expect(text()).not.toContain('Карта не загрузилась');
    expect(button('map-zoom-in')).not.toBeNull();
    expect(map.remove).not.toHaveBeenCalled();
  });

  it('ошибка стиля (до load) — кнопок нет', async () => {
    await render(<RouteMap {...props()} />);
    await flush();
    expect(button('map-zoom-in')).not.toBeNull();
    await act(async () => state.maps.at(-1)!.handlers.error!());
    expect(host.querySelector('[data-testid="map-zoom-in"]')).toBeNull();
  });
});

describe('RouteMap (web): карта на всю область и «Моё местоположение» (routes-04d)', () => {
  const button = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const HERE = [27.56, 53.9] as const;

  it('fill: колесо без модификатора масштабирует карту (RC-7), подсказки нет; атрибуция — над шторкой', async () => {
    await render(<RouteMap {...props()} fill bottomInset={240} />);
    await flush();
    const canvas = host.querySelector<HTMLElement>('[data-testid="route-map-canvas"]')!;
    const inner = document.createElement('div');
    canvas.append(inner);
    const scrollZoom = jest.fn();
    inner.addEventListener('wheel', scrollZoom);
    act(() => {
      inner.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    });
    expect(scrollZoom).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain('Чтобы изменить масштаб');
    const scope = canvas.dataset.routeMap!;
    const css = [...host.querySelectorAll('style')].map((node) => node.textContent).join('\n');
    expect(css).toContain(`[data-route-map="${scope}"] .maplibregl-ctrl-bottom-left{bottom:240px}`);
  });

  it('кнопка позиции: источник и слои точки, камера — easeTo с offset без padding; повторно — setData', async () => {
    readPosition.mockResolvedValue({ status: 'ok', lngLat: HERE });
    await render(<RouteMap {...props()} fill bottomInset={240} />);
    await flush();
    const map = state.maps.at(-1)!;
    await act(async () => map.handlers.load!());
    await act(async () => button('map-locate')!.click());
    expect(readPosition).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenLastCalledWith(LOCATION_SOURCE_ID, {
      type: 'geojson',
      data: expect.objectContaining({ type: 'FeatureCollection' }),
    });
    expect(map.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual(
      expect.arrayContaining(['my-location-halo', 'my-location-dot']),
    );
    expect(map.easeTo).toHaveBeenLastCalledWith({
      center: [...HERE],
      zoom: LOCATE_ZOOM,
      offset: [0, -120],
      animate: expect.any(Boolean),
    });
    expect(map.easeTo.mock.calls[0]![0]).not.toHaveProperty('padding');
    expect(map.setPadding).not.toHaveBeenCalled();
    readPosition.mockResolvedValue({ status: 'ok', lngLat: [27.6, 53.95] });
    await act(async () => button('map-locate')!.click());
    const source = map.getSource(LOCATION_SOURCE_ID)!;
    expect(source.setData).toHaveBeenCalledTimes(1);
    expect(map.addSource.mock.calls.filter(([id]) => id === LOCATION_SOURCE_ID)).toHaveLength(1);
  });

  it('отказ — сообщение «в настройках браузера» без ссылки; координаты не уходят в console, fetch и хранилище', async () => {
    const spies = [
      jest.spyOn(console, 'log'),
      jest.spyOn(console, 'info'),
      jest.spyOn(console, 'warn'),
      jest.spyOn(console, 'error'),
      jest.spyOn(Storage.prototype, 'setItem'),
    ];
    const fetchSpy = jest.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      readPosition.mockResolvedValue({ status: 'denied', canOpenSettings: false });
      await render(<RouteMap {...props()} />);
      await flush();
      await act(async () => button('map-locate')!.click());
      expect(text()).toContain('Нет доступа к геопозиции. Разрешите его в настройках браузера.');
      expect(host.querySelector('[data-testid="map-locate-notice"] [role="button"]')).toBeNull();
      readPosition.mockResolvedValue({ status: 'ok', lngLat: HERE });
      await act(async () => button('map-locate')!.click());
      expect(text()).not.toContain('Нет доступа к геопозиции');
      const leaked = spies
        .flatMap((spy) => spy.mock.calls)
        .concat(fetchSpy.mock.calls)
        .some((call) => JSON.stringify(call).includes('53.9'));
      expect(leaked).toBe(false);
      expect(window.location.href).not.toContain('53.9');
    } finally {
      globalThis.fetch = originalFetch;
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('ошибка чтения — «Не удалось определить местоположение»; во время чтения кнопка занята, повтор игнорируется', async () => {
    let answer: (value: Awaited<ReturnType<typeof readPosition>>) => void = () => undefined;
    readPosition.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render(<RouteMap {...props()} />);
    await flush();
    await act(async () => button('map-locate')!.click());
    expect(button('map-locate')!.getAttribute('aria-busy')).toBe('true');
    await act(async () => button('map-locate')!.click());
    expect(readPosition).toHaveBeenCalledTimes(1);
    await act(async () => answer({ status: 'unavailable' }));
    expect(text()).toContain('Не удалось определить местоположение.');
  });

  it('кнопка «в рамку» в fill — fitBounds с отступом шторки (cameraPadding)', async () => {
    await render(<RouteMap {...props()} fill bottomInset={240} />);
    await flush();
    const map = state.maps.at(-1)!;
    const canvas = host.querySelector<HTMLElement>('[data-testid="route-map-canvas"]')!;
    Object.defineProperty(canvas, 'clientHeight', { value: 700, configurable: true });
    await act(async () => button('map-fit')!.click());
    expect(map.fitBounds).toHaveBeenLastCalledWith(route.bounds, {
      padding: { ...MAP_FIT_PADDING, bottom: MAP_FIT_PADDING.bottom + 240 },
      animate: expect.any(Boolean),
    });
  });
});
