import { AVATAR_MAX_BYTES } from '@pokatim/contracts';

import { imagePickerSupported } from './image-picker-support';
import { loadImagePicker } from './load-image-picker';
import {
  AvatarPickerUnavailableError,
  AvatarPrecheckError,
  type PickedAvatar,
} from './picked-avatar';

/**
 * Выбор фото профиля на iOS и Android (rider-profile): системная галерея (PHPicker / Android Photo Picker — без
 * разрешения на всю медиатеку) и системная обрезка 1:1. Обрезка уже квадратная — `crop` не передаём, сервер берёт
 * центр. Модуля нет (старый dev-клиент) — `AvatarPickerUnavailableError`; отмена — `null`; больше 10 МиБ — ошибка до
 * отправки. EXIF и геометки стирает сервер.
 */
export async function pickAvatar(): Promise<PickedAvatar | null> {
  if (!imagePickerSupported()) throw new AvatarPickerUnavailableError();
  const { launchImageLibraryAsync } = await loadImagePicker();
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
    exif: false,
    base64: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  if (asset.fileSize !== undefined && asset.fileSize > AVATAR_MAX_BYTES) {
    throw new AvatarPrecheckError('AVATAR_TOO_LARGE');
  }
  // локальный file:// → Blob (как трек заезда): fetch RN читает файл без base64 в JS
  const body = await (await fetch(asset.uri)).blob();
  if (body.size > AVATAR_MAX_BYTES) throw new AvatarPrecheckError('AVATAR_TOO_LARGE');
  return { body };
}
