import type { Planar } from '@pokatim/tracks';

import { MAP_ASPECT_RATIO, MAP_FIT_PADDING } from './corridor-style';
import {
  cameraAfterGesture,
  clampZoom,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  zoomAround,
  type MapCamera,
} from './map-camera';

const VIEW = { width: 400, height: 300 };
const CENTER: Planar = [200, 150];

/** Пиксель вида точки `[lon, lat]` при камере `camera` (Web Mercator, тайл 512) — независимая от модуля проекция. */
function pixelOf(camera: MapCamera, [lon, lat]: [number, number]): Planar {
  const world = 512 * 2 ** camera.zoom;
  const x = (lon: number) => ((lon + 180) / 360) * world;
  const y = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2) * world;
  };
  return [
    x(lon) - x(camera.center[0]) + VIEW.width / 2,
    y(lat) - y(camera.center[1]) + VIEW.height / 2,
  ];
}

/** Координаты под пикселем вида при камере (обратная к `pixelOf`, численно — бисекцией по широте). */
function lonLatAt(camera: MapCamera, [px, py]: Planar): [number, number] {
  const world = 512 * 2 ** camera.zoom;
  const lon = camera.center[0] + ((px - VIEW.width / 2) / world) * 360;
  let lo = -85;
  let hi = 85;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (pixelOf(camera, [lon, mid])[1] > py) lo = mid;
    else hi = mid;
  }
  return [lon, (lo + hi) / 2];
}

const expectPixel = (actual: Planar, expected: Planar) => {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
};

describe('map-camera: камера жестов двумя пальцами (routes-04b, RC-2)', () => {
  it('сдвиг без масштаба: точка под пальцами едет вместе с ними, зум тот же', () => {
    const start: MapCamera = { center: [27.56, 53.9], zoom: 11 };
    const focal0: Planar = [100, 80];
    const under = lonLatAt(start, focal0);
    const next = cameraAfterGesture(start, VIEW, { focal0, focal: [160, 40], scale: 1 });
    expect(next.zoom).toBe(11);
    expectPixel(pixelOf(next, under), [160, 40]);
  });

  it('щипок вокруг центра вида: +1 зум при scale 2, центр тот же', () => {
    const start: MapCamera = { center: [27.56, 53.9], zoom: 10 };
    const next = cameraAfterGesture(start, VIEW, { focal0: CENTER, focal: CENTER, scale: 2 });
    expect(next.zoom).toBeCloseTo(11, 9);
    expect(next.center[0]).toBeCloseTo(27.56, 9);
    expect(next.center[1]).toBeCloseTo(53.9, 9);
  });

  it.each([
    [4, 0],
    [9, 41.5],
    [13, 53.9],
    [16, 69.6],
    [12, -33.9],
  ])('инвариант «точка под пальцами»: zoom %d, широта %d', (zoom, lat) => {
    const start: MapCamera = { center: [27.5, lat], zoom };
    const focal0: Planar = [310, 70];
    const under = lonLatAt(start, focal0);
    const next = cameraAfterGesture(start, VIEW, { focal0, focal: [250, 190], scale: 1.6 });
    expect(next.zoom).toBeCloseTo(
      zoom + Math.log2(1.6) > MAP_MAX_ZOOM ? MAP_MAX_ZOOM : zoom + Math.log2(1.6),
      9,
    );
    expectPixel(pixelOf(next, under), [250, 190]);
  });

  it('зум ограничен: щипок не выводит за MAP_MIN_ZOOM…MAP_MAX_ZOOM, точка под пальцами остаётся', () => {
    const near: MapCamera = { center: [27.5, 53.9], zoom: 16.5 };
    const focal0: Planar = [120, 200];
    const under = lonLatAt(near, focal0);
    const zoomedIn = cameraAfterGesture(near, VIEW, { focal0, focal: focal0, scale: 8 });
    expect(zoomedIn.zoom).toBe(MAP_MAX_ZOOM);
    expectPixel(pixelOf(zoomedIn, under), focal0);
    const far: MapCamera = { center: [27.5, 53.9], zoom: 4.5 };
    expect(cameraAfterGesture(far, VIEW, { focal0, focal: focal0, scale: 0.1 }).zoom).toBe(
      MAP_MIN_ZOOM,
    );
  });

  it('clampZoom', () => {
    expect(clampZoom(2)).toBe(MAP_MIN_ZOOM);
    expect(clampZoom(10.5)).toBe(10.5);
    expect(clampZoom(30)).toBe(MAP_MAX_ZOOM);
  });

  it('zoomAround: двойной тап — +delta зума, точка под пальцем остаётся на месте', () => {
    const start: MapCamera = { center: [27.56, 53.9], zoom: 12 };
    const point: Planar = [330, 60];
    const under = lonLatAt(start, point);
    const next = zoomAround(start, VIEW, point, 1);
    expect(next.zoom).toBe(13);
    expectPixel(pixelOf(next, under), point);
  });

  it('ревью pass 1 (M1): рамка маршрута 1000 км с севера на юг вписывается и на узком телефоне — зум рамки выше MAP_MIN_ZOOM', () => {
    // ≈ 9° широты ≈ 1000 км (предел дистанции гонки), карта 3:2 шириной 320 px, отступы рамки — как у камеры
    const [west, south, east, north] = [27, 47.5, 28, 56.5];
    const width = 320;
    const height = width / MAP_ASPECT_RATIO;
    const mercator = (lat: number) => {
      const rad = (lat * Math.PI) / 180;
      return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2;
    };
    // зум вписывания (как fitBounds MapLibre): мир 512 · 2^z, рамка в долях мира — в поле без отступов
    const fitZoom = Math.log2(
      Math.min(
        (width - MAP_FIT_PADDING.left - MAP_FIT_PADDING.right) / ((east - west) / 360),
        (height - MAP_FIT_PADDING.top - MAP_FIT_PADDING.bottom) /
          (mercator(south) - mercator(north)),
      ) / 512,
    );
    expect(fitZoom).toBeGreaterThan(MAP_MIN_ZOOM);
    expect(clampZoom(fitZoom)).toBe(fitZoom);
  });
});
