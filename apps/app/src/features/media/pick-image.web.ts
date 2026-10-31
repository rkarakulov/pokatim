import { getDocumentAsync } from 'expo-document-picker';

import {
  IMAGE_MIME_TYPES,
  ImagePrecheckError,
  isAcceptedImageType,
  type PickedImage,
  type PickImageOptions,
} from './picked-image';

/**
 * Выбор фото в браузере (аватар, фото райда): `<input type="file">` с фильтром форматов, без чтения в base64 —
 * отправляется сам `File`. Квадрат аватара выбирает `AvatarCrop` (`square` здесь не нужен); EXIF и геометки стирает
 * сервер. Отмена — `null`; не тот формат или больше `maxBytes` — ошибка до отправки.
 */
export async function pickImage({ maxBytes }: PickImageOptions): Promise<PickedImage | null> {
  const result = await getDocumentAsync({
    type: [...IMAGE_MIME_TYPES],
    multiple: false,
    base64: false,
  });
  const file = result.canceled ? undefined : result.assets[0]?.file;
  if (!file) return null;
  if (!isAcceptedImageType(file.type)) throw new ImagePrecheckError('formatUnsupported');
  if (file.size > maxBytes) throw new ImagePrecheckError('tooLarge');
  return { body: file, file };
}
