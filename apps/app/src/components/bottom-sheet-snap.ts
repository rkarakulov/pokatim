import { MAP_CAMERA_ANIMATION_MS } from '@pokatim/route-view';

/*
 * Чистая логика шторки (routes-04d, RC-2) — обе платформы: `bottom-sheet.tsx` (native, RNGH + `Animated`) и
 * `bottom-sheet.web.tsx` (pointer events). Смещение — сдвиг шторки вниз от развёрнутого положения, px: 0 — развёрнута,
 * ход (высота тела) — свёрнута.
 */

/** Наибольшая высота шторки — доля области карты (раскладка, не измерение: SSR = первый рендер). */
export const SHEET_MAX_HEIGHT = '60%' satisfies `${number}%`;

/**
 * Длительность снапа, мс; при reduce motion — без анимации. Токена длительности в `motion` нет — как у камеры карты
 * (follow-up в app-foundation).
 */
export const SHEET_ANIMATION_MS = MAP_CAMERA_ANIMATION_MS;

/** Скорость броска, px/с: быстрее — шторка уходит по направлению жеста, независимо от пройденного хода. */
export const SHEET_FLING_VELOCITY = 500;

/** Сдвиг пальца до начала перетаскивания, px: короче — касание остаётся тапом по «чёрточке». */
export const SHEET_DRAG_SLOP = 8;

/**
 * Итог перетаскивания: `true` — развернуть. Бросок быстрее `SHEET_FLING_VELOCITY` (вниз — положительная скорость)
 * решает направление; иначе — пройдена ли половина хода. Хода нет (тело не измерено) — развёрнута.
 */
export function snapExpanded(offset: number, velocity: number, range: number): boolean {
  if (range <= 0) return true;
  if (velocity > SHEET_FLING_VELOCITY) return false;
  if (velocity < -SHEET_FLING_VELOCITY) return true;
  return offset <= range / 2;
}

/** Смещение во время перетаскивания — в пределах хода. */
export function clampSheetOffset(offset: number, range: number): number {
  return Math.min(Math.max(offset, 0), Math.max(range, 0));
}
