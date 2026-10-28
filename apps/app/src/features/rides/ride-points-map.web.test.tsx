/// <reference types="jest" />
import type { RideMapPoint } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import type * as Loader from '@/features/maps/load-maplibre';
import { LOCATION_SOURCE_ID } from '@/features/maps/location-style';

import { RidePointsMap } from './ride-points-map';
import { pointsBounds, RIDE_POINTS_LAYER_ID, RIDE_POINTS_SOURCE_ID } from './ride-points-style';

// jsdom без WebGL: `maplibre-gl` подменён в точке загрузки
jest.mock('@/features/maps/load-maplibre', () => ({ loadMaplibre: jest.fn() }));
jest.mock('@/features/location/current-position', () => ({ readCurrentPosition: jest.fn() }));

type Handler = (event?: unknown) => void;
const state = { maps: [] as FakeMap[] };
class FakeMap {
  handlers: Record<string, Handler> = {};
  addSource = jest.fn();
  addLayer = jest.fn();
  remove = jest.fn();
  addControl = jest.fn();
  sources = new Map<string, { setData: jest.Mock }>();
  getSource = jest.fn((id: string) => this.sources.get(id));
  canvas = { style: { cursor: '' } };
  getCanvas = () => this.canvas;
  touchZoomRotate = { disableRotation: jest.fn() };
  keyboard = { disableRotation: jest.fn() };
  constructor(readonly options: Record<string, unknown>) {
    state.maps.push(this);
    this.addSource.mockImplementation((id: string) => {
      this.sources.set(id, { setData: jest.fn() });
    });
  }
  // `on(event, handler)` и `on(event, layerId, handler)` — ключ `event` или `event:layer`
  on(event: string, layerOrHandler: string | Handler, handler?: Handler) {
    if (typeof layerOrHandler === 'string') this.handlers[`${event}:${layerOrHandler}`] = handler!;
    else this.handlers[event] = layerOrHandler;
    return this;
  }
}
class FakeAttributionControl {
  constructor(readonly options: unknown) {}
}
const loadMaplibre = jest.mocked(
  jest.requireMock<typeof Loader>('@/features/maps/load-maplibre').loadMaplibre,
);

beforeEach(() => {
  state.maps = [];
  loadMaplibre.mockReset();
  loadMaplibre.mockImplementation(
    async () =>
      ({
        Map: FakeMap,
        AttributionControl: FakeAttributionControl,
        getVersion: () => '6.16.0',
        setWorkerUrl: () => undefined,
      }) as unknown as Awaited<ReturnType<typeof Loader.loadMaplibre>>,
  );
});

const START = [27.5615, 53.9023] as const;
const point = (id: string, title: string): RideMapPoint => ({
  id: `0190a6f4-0000-7000-8000-00000000000${id}`,
  title,
  startsAt: '2026-10-04T07:00:00Z',
  start: [START[0], START[1]],
  goingCount: 2,
  limit: 10,
  full: false,
});
const points = [point('1', 'Море'), point('2', 'Озеро')];
const ME = [27.4, 53.8] as const;
const onOpen = jest.fn();
const props = (me: readonly [number, number] | null = null) => ({
  points,
  me,
  bounds: pointsBounds(points, me, START),
  styleUrl: 'https://tiles.example/styles/positron',
  theme: themes.light,
  accessibilityLabel: 'Карта точек старта: на карте 2 райда',
  failedMessage: 'Карта не загрузилась',
  now: new Date('2026-10-01T12:00:00Z'),
  onOpen,
});

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
const flush = () => act(async () => {});
const text = () => host.textContent ?? '';

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  onOpen.mockReset();
});

describe('RidePointsMap (web, maplibre-gl), 05c', () => {
  it('серверный рендер: место карты с подписью без координат, maplibre-gl не загружен', () => {
    const html = renderToString(<RidePointsMap {...props(ME)} />);
    expect(html).toContain('Карта точек старта: на карте 2 райда');
    expect(html).not.toMatch(/27\.4|53\.8/);
    expect(loadMaplibre).not.toHaveBeenCalled();
  });

  it('после load: источник с одной точкой группы и слои; позиция «Рядом» — источник точки пользователя', async () => {
    await render(<RidePointsMap {...props(ME)} />);
    await flush();
    const [map] = state.maps;
    expect(map!.options).toMatchObject({ attributionControl: false, bounds: props(ME).bounds });
    await act(async () => map!.handlers.load!());
    const [id, source] = map!.addSource.mock.calls[0]!;
    expect(id).toBe(RIDE_POINTS_SOURCE_ID);
    expect(source.data.features).toHaveLength(1);
    expect(source.data.features[0].properties.count).toBe(2);
    expect(map!.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual([
      'ride-points',
      'ride-points-count',
      'my-location-halo',
      'my-location-dot',
    ]);
    expect(map!.addSource).toHaveBeenCalledWith(
      LOCATION_SOURCE_ID,
      expect.objectContaining({ type: 'geojson' }),
    );
  });

  it('клик по точке — карточка с райдами группы → onOpen(id); курсор pointer; «Закрыть»', async () => {
    await render(<RidePointsMap {...props()} />);
    await flush();
    const map = state.maps.at(-1)!;
    await act(async () => map.handlers.load!());
    const key = map.addSource.mock.calls[0]![1].data.features[0].properties.key;

    map.handlers[`mouseenter:${RIDE_POINTS_LAYER_ID}`]!();
    expect(map.canvas.style.cursor).toBe('pointer');
    map.handlers[`mouseleave:${RIDE_POINTS_LAYER_ID}`]!();
    expect(map.canvas.style.cursor).toBe('');

    expect(text()).not.toContain('Озеро');
    await act(async () =>
      map.handlers[`click:${RIDE_POINTS_LAYER_ID}`]!({ features: [{ properties: { key } }] }),
    );
    expect(text()).toContain('В этой точке 2 райда');
    const link = [...host.querySelectorAll('[role="link"]')].find((node) =>
      node.textContent?.includes('Озеро'),
    ) as HTMLElement;
    await act(async () => link.click());
    expect(onOpen).toHaveBeenCalledWith(points[1]!.id);

    const close = [...host.querySelectorAll('[role="button"]')].find(
      (node) => node.textContent === 'Закрыть',
    ) as HTMLElement;
    await act(async () => close.click());
    expect(text()).not.toContain('Озеро');
  });

  it('ошибка до load — сообщение поверх карты', async () => {
    await render(<RidePointsMap {...props()} />);
    await flush();
    await act(async () => state.maps.at(-1)!.handlers.error!());
    expect(text()).toContain('Карта не загрузилась');
  });
});
