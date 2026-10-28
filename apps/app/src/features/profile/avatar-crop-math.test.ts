/// <reference types="jest" />
import { AVATAR_MIN_CROP_PX } from '@pokatim/contracts';

import {
  initialCrop,
  MAX_ZOOM,
  maxScale,
  pan,
  scaleOf,
  toCropQuery,
  tooSmall,
  zoom,
} from './avatar-crop-math';

const landscape = { width: 1200, height: 800 };
const portrait = { width: 600, height: 900 };

/** Серверный `cropRect` (apps/api `avatar-image.ts`): доли клиента должны давать тот же квадрат. */
function serverRect(width: number, height: number, crop: { x: number; y: number; size: number }) {
  const short = Math.min(width, height);
  const side = Math.min(short, Math.round(crop.size * short));
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  return {
    left: clamp(Math.round(crop.x * width), width - side),
    top: clamp(Math.round(crop.y * height), height - side),
    side,
  };
}

describe('обрезка аватара (web): математика', () => {
  it('начало — центральный квадрат во всю меньшую сторону, масштаб 1', () => {
    expect(initialCrop(landscape)).toEqual({ left: 200, top: 0, side: 800 });
    expect(initialCrop(portrait)).toEqual({ left: 0, top: 150, side: 600 });
    expect(scaleOf(initialCrop(landscape), landscape)).toBe(1);
  });

  it('сдвиг — в рамках изображения', () => {
    const start = initialCrop(landscape);
    expect(pan(start, -500, 0, landscape)).toEqual({ left: 0, top: 0, side: 800 });
    expect(pan(start, 500, 0, landscape)).toEqual({ left: 400, top: 0, side: 800 });
    expect(pan(start, 0, 100, landscape)).toEqual(start);
  });

  it('масштаб — вокруг центра, в пределах [1, предел]; предел — 64 px исходника или MAX_ZOOM', () => {
    const start = initialCrop(landscape);
    expect(zoom(start, 2, landscape)).toEqual({ left: 400, top: 200, side: 400 });
    expect(zoom(start, 0.5, landscape)).toEqual(start);
    expect(scaleOf(zoom(start, 100, landscape), landscape)).toBe(MAX_ZOOM);

    const small = { width: 128, height: 200 };
    expect(maxScale(small)).toBe(2);
    expect(zoom(initialCrop(small), 10, small).side).toBe(AVATAR_MIN_CROP_PX);
  });

  it('у края масштаб не выводит квадрат за рамки', () => {
    const corner = pan(zoom(initialCrop(landscape), 2, landscape), -1000, -1000, landscape);
    expect(corner).toEqual({ left: 0, top: 0, side: 400 });
    expect(zoom(corner, 0.5, landscape)).toEqual({ left: 0, top: 0, side: 800 });
  });

  it('доли в [0, 1] и совпадают с серверной формулой', () => {
    const states = [
      initialCrop(landscape),
      pan(zoom(initialCrop(landscape), 3, landscape), 333, -50, landscape),
      pan(zoom(initialCrop(landscape), 4, landscape), 10_000, 10_000, landscape),
    ];
    for (const state of states) {
      const query = toCropQuery(state, landscape);
      for (const value of Object.values(query)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(query.size).toBeGreaterThan(0);
      const rect = serverRect(landscape.width, landscape.height, query);
      expect(rect.side).toBe(Math.round(state.side));
      expect(Math.abs(rect.left - state.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(rect.top - state.top)).toBeLessThanOrEqual(1);
    }
  });

  it('фото меньше 64 × 64 — мелкое', () => {
    expect(tooSmall({ width: 63, height: 500 })).toBe(true);
    expect(tooSmall({ width: 64, height: 64 })).toBe(false);
  });
});
