/** Форматы фото, которые принимает сервер (сигнатура проверяется там же): аватар и фото райда. */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Выбранное фото: байты для загрузки (`PUT` с `application/octet-stream`). */
export interface PickedImage {
  body: Blob;
  /** web: сам файл (аватар — исходник для обрезки `AvatarCrop`) */
  file?: File;
}

export interface PickImageOptions {
  /** предел тела загрузки — больше — отказ до отправки */
  maxBytes: number;
  /** native: системная обрезка 1:1 (аватар); `false` — фото как есть, вписывает сервер (фото райда) */
  square: boolean;
}

/** В сборке нет нативного модуля выбора фото (старый dev-клиент) — «Обновите приложение». */
export class ImagePickerUnavailableError extends Error {
  constructor() {
    super('image picker unavailable');
    this.name = 'ImagePickerUnavailableError';
  }
}

/** Фото не прошло проверку до отправки: больше предела или не JPEG/PNG/WebP (HEIC из Safari, HEIF с Android). */
export class ImagePrecheckError extends Error {
  constructor(readonly reason: 'tooLarge' | 'formatUnsupported') {
    super(reason);
    this.name = 'ImagePrecheckError';
  }
}

export const isAcceptedImageType = (type: string): boolean =>
  (IMAGE_MIME_TYPES as readonly string[]).includes(type);
