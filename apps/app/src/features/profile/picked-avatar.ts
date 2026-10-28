/** Выбранное фото профиля (rider-profile): байты для `PUT /v1/profile/avatar`; обрезку native сделал системный экран. */
export interface PickedAvatar {
  body: Blob;
  /** web: файл до обрезки — квадрат выбирает `AvatarCrop` (доли уходят в query) */
  file?: File;
}

/** В сборке нет нативного модуля выбора фото (старый dev-клиент) — «Обновите приложение». */
export class AvatarPickerUnavailableError extends Error {
  constructor() {
    super('image picker unavailable');
    this.name = 'AvatarPickerUnavailableError';
  }
}

/** Фото не прошло проверку до отправки: размер, формат, не декодируется, мелкое — тот же текст, что у ответа сервера. */
export class AvatarPrecheckError extends Error {
  constructor(
    readonly reason:
      'AVATAR_TOO_LARGE' | 'AVATAR_FORMAT_UNSUPPORTED' | 'AVATAR_INVALID' | 'tooSmall',
  ) {
    super(reason);
    this.name = 'AvatarPrecheckError';
  }
}
