import { AVATAR_MIN_CROP_PX } from '@pokatim/contracts';

/*
 * Обрезка аватара на web (rider-profile) — чистая математика без DOM. Состояние — квадрат в пикселях ориентированного
 * изображения (`naturalWidth/naturalHeight`): левый верхний угол и сторона. На сервер уходят доли (`toCropQuery`) —
 * та же система координат, что у серверного `cropRect` (EXIF-ориентацию браузер и сервер применяют одинаково); итог
 * и пределы проверяет сервер.
 */

/** Потолок масштаба: дальше пиксели исходника крупнее окна обрезки — смысла нет. */
export const MAX_ZOOM = 4;

export interface CropState {
  left: number;
  top: number;
  side: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

const shortSide = ({ width, height }: ImageSize) => Math.min(width, height);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Фото меньше минимальной стороны обрезки — отправлять нечего (сервер ответил бы 422). */
export const tooSmall = (image: ImageSize) => shortSide(image) < AVATAR_MIN_CROP_PX;

/** Начало: центральный квадрат во всю меньшую сторону (масштаб 1, как без обрезки на сервере). */
export function initialCrop(image: ImageSize): CropState {
  const side = shortSide(image);
  return { left: (image.width - side) / 2, top: (image.height - side) / 2, side };
}

/** Предельный масштаб: сторона обрезки не меньше `AVATAR_MIN_CROP_PX` пикселей исходника и не больше `MAX_ZOOM`. */
export const maxScale = (image: ImageSize) =>
  Math.max(1, Math.min(shortSide(image) / AVATAR_MIN_CROP_PX, MAX_ZOOM));

/** Текущий масштаб: 1 — квадрат во всю меньшую сторону. */
export const scaleOf = (state: CropState, image: ImageSize) => shortSide(image) / state.side;

/** Квадрат не выходит за рамки изображения. */
function contain(state: CropState, image: ImageSize): CropState {
  return {
    side: state.side,
    left: clamp(state.left, 0, image.width - state.side),
    top: clamp(state.top, 0, image.height - state.side),
  };
}

/** Масштаб в `factor` раз вокруг центра окна, в пределах `[1, maxScale]`. */
export function zoom(state: CropState, factor: number, image: ImageSize): CropState {
  const scale = clamp(scaleOf(state, image) * factor, 1, maxScale(image));
  const side = shortSide(image) / scale;
  const centerX = state.left + state.side / 2;
  const centerY = state.top + state.side / 2;
  return contain({ left: centerX - side / 2, top: centerY - side / 2, side }, image);
}

/** Сдвиг квадрата на `dx, dy` пикселей исходника, в рамках изображения. */
export const pan = (state: CropState, dx: number, dy: number, image: ImageSize): CropState =>
  contain({ ...state, left: state.left + dx, top: state.top + dy }, image);

/** Доли для `PUT /v1/profile/avatar?x&y&size` (`AvatarCropQuery`): все в `[0, 1]`, `size > 0`. */
export function toCropQuery(state: CropState, image: ImageSize) {
  return {
    x: clamp(state.left / image.width, 0, 1),
    y: clamp(state.top / image.height, 0, 1),
    size: clamp(state.side / shortSide(image), Number.MIN_VALUE, 1),
  };
}
