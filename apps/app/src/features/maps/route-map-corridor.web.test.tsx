/// <reference types="jest" />
import type { RaceRouteMap } from '@pokatim/contracts';
import { stroke, themes } from '@pokatim/design-tokens';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CORRIDOR_LAYER_ID, ROUTE_CATALOG_LINE_WIDTH } from './corridor-style';
import type * as Loader from './load-maplibre';
import { RouteMap } from './route-map';

interface MockMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void>;
  addSource: jest.Mock;
  addLayer: jest.Mock;
  remove: jest.Mock;
}

// jsdom без WebGL: `maplibre-gl` подменён в точке загрузки (`load-maplibre`): фабрика — только при вызове
jest.mock('./load-maplibre', () => ({ loadMaplibre: jest.fn() }));

const state = { maps: [] as MockMap[], workerUrl: '' };
class FakeMap implements MockMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void> = {};
  addSource = jest.fn();
  addLayer = jest.fn();
  remove = jest.fn();
  addControl = jest.fn();
  touchZoomRotate = { disableRotation: jest.fn() };
  keyboard = { disableRotation: jest.fn() };
  constructor(options: Record<string, unknown>) {
    this.options = options;
    state.maps.push(this);
  }
  on(event: string, handler: () => void) {
    this.handlers[event] = handler;
    return this;
  }
}
const loadMaplibre = jest.mocked(jest.requireMock<typeof Loader>('./load-maplibre').loadMaplibre);

beforeEach(() => {
  state.maps = [];
  state.workerUrl = '';
  loadMaplibre.mockReset();
  loadMaplibre.mockImplementation(
    async () =>
      // мок модуля: только то, что зовёт карта
      ({
        Map: FakeMap,
        // routes-04d: атрибуция — отдельным контролом слева внизу
        AttributionControl: class {},
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

const props = () => ({
  map: route,
  styleUrl: LIGHT,
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
}

/** Дождаться промиса динамического `import()` и эффекта. */
const flush = () => act(async () => {});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('RouteMap без коридора (web, routes-01)', () => {
  it('corridor={false}: линия, старт и финиш — слоя коридора нет', async () => {
    await render(<RouteMap {...props()} corridor={false} />);
    await flush();
    const map = state.maps.at(-1)!;
    await act(async () => map.handlers.load!());
    expect(map.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual([
      'route',
      'start',
      'finish',
    ]);
  });

  it('без пропса — коридор как прежде (по умолчанию true)', async () => {
    await render(<RouteMap {...props()} />);
    await flush();
    const map = state.maps.at(-1)!;
    await act(async () => map.handlers.load!());
    expect(map.addLayer.mock.calls.map(([layer]) => layer.id)[0]).toBe(CORRIDOR_LAYER_ID);
  });
});

describe('RouteMap: толщина линии (web, routes-03)', () => {
  const routeWidth = (map: MockMap) =>
    map.addLayer.mock.calls.find(([layer]) => layer.id === 'route')![0].paint['line-width'];

  it('lineWidth — в слое route; без пропса — stroke.indicator (карта гонки)', async () => {
    await render(<RouteMap {...props()} corridor={false} lineWidth={ROUTE_CATALOG_LINE_WIDTH} />);
    await flush();
    const catalog = state.maps.at(-1)!;
    await act(async () => catalog.handlers.load!());
    expect(routeWidth(catalog)).toBe(5);
    await act(async () => root?.unmount());
    root = null;

    await render(<RouteMap {...props()} />);
    await flush();
    const race = state.maps.at(-1)!;
    await act(async () => race.handlers.load!());
    expect(routeWidth(race)).toBe(stroke.indicator);
  });
});
