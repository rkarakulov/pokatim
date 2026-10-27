import { MAP_CAMERA_ANIMATION_MS } from '@pokatim/route-view';

import {
  clampSheetOffset,
  SHEET_ANIMATION_MS,
  SHEET_FLING_VELOCITY,
  SHEET_MAX_HEIGHT,
  snapExpanded,
} from './bottom-sheet-snap';

describe('bottom-sheet-snap (routes-04d, RC-2)', () => {
  it('без скорости — по половине хода: меньше половины — развёрнута, больше — свёрнута', () => {
    expect(snapExpanded(0, 0, 300)).toBe(true);
    expect(snapExpanded(149, 0, 300)).toBe(true);
    expect(snapExpanded(151, 0, 300)).toBe(false);
    expect(snapExpanded(300, 0, 300)).toBe(false);
  });

  it('скорость выше порога решает направление независимо от хода', () => {
    expect(snapExpanded(20, SHEET_FLING_VELOCITY + 1, 300)).toBe(false);
    expect(snapExpanded(280, -SHEET_FLING_VELOCITY - 1, 300)).toBe(true);
    // на пороге — по ходу
    expect(snapExpanded(20, SHEET_FLING_VELOCITY, 300)).toBe(true);
  });

  it('хода нет (тело не измерено) — развёрнута', () => {
    expect(snapExpanded(0, 1000, 0)).toBe(true);
  });

  it('смещение — в пределах хода', () => {
    expect(clampSheetOffset(-20, 300)).toBe(0);
    expect(clampSheetOffset(120, 300)).toBe(120);
    expect(clampSheetOffset(420, 300)).toBe(300);
  });

  it('константы: доля области карты, длительность — как у камеры', () => {
    expect(SHEET_MAX_HEIGHT).toMatch(/^\d+%$/);
    expect(SHEET_ANIMATION_MS).toBe(MAP_CAMERA_ANIMATION_MS);
  });
});
