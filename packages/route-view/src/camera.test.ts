import { describe, expect, it } from 'vitest';
import { MAP_ASPECT_RATIO, MAP_FIT_PADDING } from './route-layers.ts';
import {
  CAMERA_MIN_VIEW_PX,
  cameraCall,
  cameraPadding,
  clampZoom,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
} from './camera.ts';

describe('map-camera: ограничения зума (routes-04b, RC-8)', () => {
  it('clampZoom', () => {
    expect(clampZoom(2)).toBe(MAP_MIN_ZOOM);
    expect(clampZoom(10.5)).toBe(10.5);
    expect(clampZoom(30)).toBe(MAP_MAX_ZOOM);
  });

  it('cameraCall: синхронная ошибка и отклонённый промис камеры не пробрасываются', async () => {
    expect(() =>
      cameraCall(() => {
        throw new Error('NativeCameraComponent ref is null');
      }),
    ).not.toThrow();
    cameraCall(() => Promise.reject(new Error('jest: нативной карты нет')));
    await Promise.resolve();
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

describe('cameraPadding (routes-04d, RC-5): отступ камеры над шторкой', () => {
  it('без шторки — базовый отступ рамки', () => {
    expect(cameraPadding(0, 600)).toEqual(MAP_FIT_PADDING);
    expect(cameraPadding(0, null)).toEqual(MAP_FIT_PADDING);
  });

  it('шторка — снизу база + её видимая высота', () => {
    expect(cameraPadding(300, 700)).toEqual({
      ...MAP_FIT_PADDING,
      bottom: MAP_FIT_PADDING.bottom + 300,
    });
  });

  it('высота карты неизвестна — без inset сверх базы', () => {
    expect(cameraPadding(300, null)).toEqual(MAP_FIT_PADDING);
  });

  it('ограничение по высоте карты: отступы не больше холста — над шторкой остаётся место камеры', () => {
    const padding = cameraPadding(500, 520);
    expect(padding.top + padding.bottom).toBeLessThanOrEqual(520 - CAMERA_MIN_VIEW_PX);
    expect(padding.bottom).toBeGreaterThanOrEqual(MAP_FIT_PADDING.bottom);
    // совсем низкая карта — не меньше базы
    expect(cameraPadding(500, 50).bottom).toBe(MAP_FIT_PADDING.bottom);
  });

  it('целые пиксели (натив принимает Int32)', () => {
    expect(Number.isInteger(cameraPadding(123.6, 700).bottom)).toBe(true);
  });
});
