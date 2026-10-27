/// <reference types="jest" />
import type { RaceRouteMap } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type * as Loader from './load-maplibre';
import { RouteMap } from './route-map';
import * as Frame from './route-map-frame';
import { createScrubStore, type ScrubStore } from './scrub-store';

jest.mock('./load-maplibre', () => ({ loadMaplibre: jest.fn() }));

/** Проекция FakeMap: lon → x, lat → y (север вверх) с масштабом `scale` px на градус. */
const state = { maps: [] as FakeMap[], scale: 1000 };
class FakeMap {
  handlers: Record<string, (() => void)[]> = {};
  addSource = jest.fn();
  addLayer = jest.fn();
  remove = jest.fn();
  touchZoomRotate = { disableRotation: jest.fn() };
  keyboard = { disableRotation: jest.fn() };
  project = jest.fn(([lon, lat]: [number, number]) => ({
    x: (lon - 27.5) * state.scale,
    y: (54.0 - lat) * state.scale,
  }));
  constructor() {
    state.maps.push(this);
  }
  on(event: string, handler: () => void) {
    (this.handlers[event] ??= []).push(handler);
    return this;
  }
  emit(event: string) {
    for (const handler of this.handlers[event] ?? []) handler();
  }
}
const loadMaplibre = jest.mocked(jest.requireMock<typeof Loader>('./load-maplibre').loadMaplibre);

beforeEach(() => {
  state.maps = [];
  state.scale = 1000;
  loadMaplibre.mockReset();
  loadMaplibre.mockImplementation(
    async () =>
      ({
        Map: FakeMap,
        getVersion: () => '6.16.0',
        setWorkerUrl: () => undefined,
      }) as unknown as Awaited<ReturnType<typeof Loader.loadMaplibre>>,
  );
});

// линия «туда-обратно» по долготе на одной широте: 27.5 → 27.6 → 27.5 (≈ 6,6 км каждый проход)
const route: RaceRouteMap = {
  line: [
    [27.5, 54.0],
    [27.6, 54.0],
    [27.5, 54.0],
  ],
  start: [27.5, 54.0],
  finish: [27.5, 54.0],
  bounds: [27.5, 54.0, 27.6, 54.0],
  widthM: 50,
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement;
async function render(element: ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  await act(async () => created.render(element));
  return { rerender: (next: ReactNode) => act(async () => created.render(next)) };
}
const flush = () => act(async () => {});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const element = (scrub?: ScrubStore) => (
  <RouteMap
    map={route}
    styleUrl="https://tiles.example/styles/positron"
    theme={themes.light}
    accessibilityLabel="Карта маршрута"
    failedMessage="Карта не загрузилась"
    corridor={false}
    scrub={scrub}
  />
);
const marker = () => host.querySelector<HTMLElement>('[data-testid="scrub-marker"]');
/** центр маркера (touchMin 44 → смещение 22) */
const markerAt = () => {
  const [, x, y] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(marker()!.style.transform) ?? [];
  return [Number(x), Number(y)];
};
const expectMarkerAt = (x: number, y: number) => {
  const [mx, my] = markerAt();
  expect(mx).toBeCloseTo(x, 6);
  expect(my).toBeCloseTo(y, 6);
};

function pointer(target: Element, type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

describe('RouteMap web: маркер скраббинга (routes-04, RC-2)', () => {
  it('без scrub — маркера нет и project не вызывается (карта гонки)', async () => {
    await render(element());
    await flush();
    await act(async () => state.maps[0]!.emit('load'));
    expect(marker()).toBeNull();
    expect(state.maps[0]!.project).not.toHaveBeenCalled();
  });

  it('после load — маркер на старте; движение стора двигает маркер без пересоздания карты и источника', async () => {
    const store = createScrubStore();
    await render(element(store));
    await flush();
    expect(marker()).toBeNull();
    const map = state.maps[0]!;
    await act(async () => map.emit('load'));
    expect(map.project).toHaveBeenCalledTimes(3);
    expectMarkerAt(-22, -22);
    await act(async () => store.setState({ fraction: 0.25 }));
    expectMarkerAt(28, -22);
    await act(async () => store.setState({ fraction: 0.5, active: true }));
    expectMarkerAt(78, -22);
    expect(state.maps).toHaveLength(1);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.remove).not.toHaveBeenCalled();
  });

  it('resize — пересчёт проекции', async () => {
    const store = createScrubStore();
    await render(element(store));
    await flush();
    const map = state.maps[0]!;
    await act(async () => map.emit('load'));
    await act(async () => store.setState({ fraction: 0.5 }));
    state.scale = 2000;
    await act(async () => map.emit('resize'));
    expectMarkerAt(178, -22);
  });

  it('перетаскивание маркера: dragging «map», доля — ближайшая точка с подсказкой (обратный проход)', async () => {
    const store = createScrubStore();
    await render(element(store));
    await flush();
    await act(async () => state.maps[0]!.emit('load'));
    await act(async () => store.setState({ fraction: 0.9 }));
    const overlay = marker()!.parentElement!;
    overlay.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 }) as DOMRect;
    await act(async () => pointer(marker()!, 'pointerdown', 20, 0));
    expect(store.getState()).toMatchObject({ dragging: 'map', active: true });
    // x = 30 px — 30 % длины прохода: на обратном проходе (подсказка 0,9) — доля 0,85, не 0,15
    await act(async () => pointer(marker()!, 'pointermove', 30, 3));
    expect(store.getState().fraction).toBeCloseTo(0.85, 6);
    await act(async () => pointer(marker()!, 'pointerup', 30, 3));
    expect(store.getState()).toMatchObject({ dragging: null, active: true });
    // без нажатия движение не двигает
    await act(async () => pointer(marker()!, 'pointermove', 90, 0));
    expect(store.getState().fraction).toBeCloseTo(0.85, 6);
  });

  it('routes-04b (I4, RC-4): move (перетаскивание и зум) — маркер на линии без ре-рендера RouteMap и addLayer', async () => {
    const frame = jest.spyOn(Frame, 'RouteMapFrame');
    const store = createScrubStore();
    await render(element(store));
    await flush();
    const map = state.maps[0]!;
    await act(async () => map.emit('load'));
    await act(async () => store.setState({ fraction: 0.5 }));
    const frameRenders = frame.mock.calls.length;
    const layers = map.addLayer.mock.calls.length;
    for (const scale of [1500, 2500, 3000]) {
      state.scale = scale;
      await act(async () => map.emit('move'));
      // доля 0,5 — разворот на 27,6: x = 0,1 × scale
      expectMarkerAt(0.1 * scale - 22, -22);
    }
    expect(frame.mock.calls.length).toBe(frameRenders);
    expect(map.addLayer.mock.calls.length).toBe(layers);
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(state.maps).toHaveLength(1);
    frame.mockRestore();
  });
});
