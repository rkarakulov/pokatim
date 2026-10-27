// @vitest-environment jsdom
import type { RouteMapGeometry } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import {
  CORRIDOR_LAYER_ID,
  createScrubStore,
  MAP_FIT_PADDING,
  ROUTE_CATALOG_LINE_WIDTH,
  ROUTE_SOURCE_ID,
} from '@pokatim/route-view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMaplibre } from './load-maplibre';
import { RouteMap } from './RouteMap';

// jsdom без WebGL: `maplibre-gl` подменён в точке загрузки
vi.mock('./load-maplibre', () => ({ loadMaplibre: vi.fn() }));

const state = { maps: [] as FakeMap[] };
class FakeMap {
  options: Record<string, unknown>;
  handlers: Record<string, () => void> = {};
  addSource = vi.fn();
  addLayer = vi.fn();
  remove = vi.fn();
  zoomIn = vi.fn();
  zoomOut = vi.fn();
  fitBounds = vi.fn();
  // проекция: сдвиг камеры — `offset` пикселей
  offset = 0;
  project = vi.fn(([lon, lat]: [number, number]) => ({
    x: (lon - 27.5) * 100 + this.offset,
    y: (54 - lat) * 100,
  }));
  touchZoomRotate = { disableRotation: vi.fn() };
  keyboard = { disableRotation: vi.fn() };
  constructor(options: Record<string, unknown>) {
    this.options = options;
    state.maps.push(this);
  }
  on(event: string, handler: () => void) {
    this.handlers[event] = handler;
    return this;
  }
}

beforeEach(() => {
  state.maps = [];
  vi.mocked(loadMaplibre).mockResolvedValue({ Map: FakeMap } as unknown as Awaited<
    ReturnType<typeof loadMaplibre>
  >);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const geometry: RouteMapGeometry = {
  line: [
    [27.5, 53.5],
    [28.5, 54.0],
  ],
  start: [27.5, 53.5],
  finish: [28.5, 54.0],
  bounds: [27.5, 53.5, 28.5, 54.0],
};
const STYLE = 'https://tiles.example/styles/positron';

async function renderMap(scrub?: ReturnType<typeof createScrubStore>) {
  const view = render(
    <RouteMap
      geometry={geometry}
      styleUrl={STYLE}
      label="Карта маршрута"
      variant="page"
      {...(scrub ? { scrub } : {})}
    />,
  );
  await act(async () => {});
  return { ...view, map: state.maps[0]! };
}

describe('RouteMap панели (routes-05, A2)', () => {
  it('без загрузки — место карты с подписью; карты и кнопок нет', () => {
    vi.mocked(loadMaplibre).mockReturnValue(new Promise(() => {}));
    render(
      <RouteMap geometry={geometry} styleUrl={STYLE} label="Карта маршрута" variant="compact" />,
    );
    expect(screen.getByRole('img', { name: 'Карта маршрута' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Приблизить' })).toBeNull();
  });

  it('опции: один палец, без кооперативного режима, зум 2–17, стиль из env, камера по рамке', async () => {
    const { map } = await renderMap();
    expect(map.options).toMatchObject({
      style: STYLE,
      cooperativeGestures: false,
      dragRotate: false,
      minZoom: 2,
      maxZoom: 17,
      bounds: geometry.bounds,
      fitBoundsOptions: { padding: MAP_FIT_PADDING, animate: false },
    });
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled();
    expect(map.keyboard.disableRotation).toHaveBeenCalled();
  });

  it('load: источник маршрута и слои без коридора, линия 5 px цвета темы панели', async () => {
    const { map } = await renderMap();
    act(() => map.handlers.load!());
    expect(map.addSource).toHaveBeenCalledWith(ROUTE_SOURCE_ID, expect.anything());
    const layers = map.addLayer.mock.calls.map(([layer]) => layer as { id: string; paint: object });
    expect(layers.map((layer) => layer.id)).not.toContain(CORRIDOR_LAYER_ID);
    expect(layers.find((layer) => layer.id === 'route')?.paint).toEqual({
      'line-color': themes.panel.map.route,
      'line-width': ROUTE_CATALOG_LINE_WIDTH,
    });
    expect(ROUTE_CATALOG_LINE_WIDTH).toBe(5);
  });

  it('ошибка до load — «Карта не загрузилась»; после load — без сообщения', async () => {
    const first = await renderMap();
    act(() => first.map.handlers.error!());
    expect(screen.getByText('Карта не загрузилась')).toBeTruthy();
    cleanup();
    state.maps = [];
    const second = await renderMap();
    act(() => second.map.handlers.load!());
    act(() => second.map.handlers.error!());
    expect(screen.queryByText('Карта не загрузилась')).toBeNull();
  });

  it('кнопки «+», «−», «в рамку» управляют камерой; размонтирование — remove', async () => {
    const { map, unmount } = await renderMap();
    fireEvent.click(screen.getByRole('button', { name: 'Приблизить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отдалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Показать маршрут целиком' }));
    expect(map.zoomIn).toHaveBeenCalledTimes(1);
    expect(map.zoomOut).toHaveBeenCalledTimes(1);
    expect(map.fitBounds).toHaveBeenCalledWith(
      geometry.bounds,
      expect.objectContaining({ padding: MAP_FIT_PADDING }),
    );
    unmount();
    expect(map.remove).toHaveBeenCalled();
  });

  it('колесо без Ctrl/⌘ — подсказка поверх карты', async () => {
    await renderMap();
    fireEvent.wheel(screen.getByTestId('route-map-canvas'));
    expect(screen.getByText(/крутите колесо/)).toBeTruthy();
  });

  it('скраббинг: маркер по project после load, перерасчёт на move; без стора — маркера нет', async () => {
    const scrub = createScrubStore();
    const { map } = await renderMap(scrub);
    expect(screen.queryByTestId('scrub-marker')).toBeNull();
    act(() => map.handlers.load!());
    const marker = screen.getByTestId('scrub-marker');
    expect(marker.style.transform).toBe('translate(0px, 50px)');
    act(() => scrub.setState({ fraction: 1 }));
    expect(marker.style.transform).toBe('translate(100px, 0px)');
    map.offset = 10;
    act(() => map.handlers.move!());
    expect(screen.getByTestId('scrub-marker').style.transform).toBe('translate(110px, 0px)');

    cleanup();
    state.maps = [];
    const plain = await renderMap();
    act(() => plain.map.handlers.load!());
    expect(screen.queryByTestId('scrub-marker')).toBeNull();
  });
});
