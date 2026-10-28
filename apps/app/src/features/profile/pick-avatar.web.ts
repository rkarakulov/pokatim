import { AVATAR_MAX_BYTES } from '@pokatim/contracts';
import { getDocumentAsync } from 'expo-document-picker';

import { AvatarPrecheckError, type PickedAvatar } from './picked-avatar';

/** Форматы, которые принимает сервер (сигнатура проверяется там же); HEIC из Safari — понятный отказ до отправки. */
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Выбор фото профиля в браузере (rider-profile): `<input type="file">` с фильтром форматов, без чтения в base64 —
 * отправляется сам `File`. Квадрат выбирает `AvatarCrop` (`avatar-editor.web.tsx`), исходник уходит как есть: EXIF и
 * геометки стирает сервер. Отмена — `null`; не тот формат или больше 10 МиБ — ошибка до обрезки.
 */
export async function pickAvatar(): Promise<PickedAvatar | null> {
  const result = await getDocumentAsync({
    type: [...AVATAR_MIME_TYPES],
    multiple: false,
    base64: false,
  });
  const file = result.canceled ? undefined : result.assets[0]?.file;
  if (!file) return null;
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new AvatarPrecheckError('AVATAR_FORMAT_UNSUPPORTED');
  }
  if (file.size > AVATAR_MAX_BYTES) throw new AvatarPrecheckError('AVATAR_TOO_LARGE');
  return { body: file, file };
}
