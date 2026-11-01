import {
  ImagePickerUnavailableError,
  ImagePrecheckError,
  type PickedImage,
} from '@/features/media/picked-image';

/**
 * Выбранное фото профиля (rider-profile): байты для `PUT /v1/profile/avatar`; обрезку native сделал системный экран,
 * web — `file` до обрезки (квадрат выбирает `AvatarCrop`, доли уходят в query).
 */
export type PickedAvatar = PickedImage;

/** В сборке нет нативного модуля выбора фото (старый dev-клиент) — «Обновите приложение». */
export { ImagePickerUnavailableError as AvatarPickerUnavailableError };

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

/** Отказ общего выбора фото — в ошибку аватара (тексты `avatar-errors.ts`); прочее — как есть. */
export function avatarPickError(error: unknown): unknown {
  if (!(error instanceof ImagePrecheckError)) return error;
  return new AvatarPrecheckError(
    error.reason === 'tooLarge' ? 'AVATAR_TOO_LARGE' : 'AVATAR_FORMAT_UNSUPPORTED',
  );
}
