import { imagePickerSupported } from './image-picker-support';
import { loadImagePicker } from './load-image-picker';
import {
  ImagePickerUnavailableError,
  ImagePrecheckError,
  isAcceptedImageType,
  type PickedImage,
  type PickImageOptions,
} from './picked-image';

/**
 * Выбор фото на iOS и Android (аватар, фото райда): системная галерея (PHPicker / Android Photo Picker — без разрешения
 * на всю медиатеку). `square` — системная обрезка 1:1 (аватар); иначе — фото как есть, iOS отдаёт совместимое
 * представление (HEIC → JPEG), вписывает сервер. Модуля нет (старый dev-клиент) — `ImagePickerUnavailableError`;
 * отмена — `null`; больше `maxBytes` или не JPEG/PNG/WebP — ошибка до отправки. EXIF и геометки стирает сервер.
 */
export async function pickImage({
  maxBytes,
  square,
}: PickImageOptions): Promise<PickedImage | null> {
  if (!imagePickerSupported()) throw new ImagePickerUnavailableError();
  const picker = await loadImagePicker();
  const framing = square
    ? { allowsEditing: true, aspect: [1, 1] as [number, number] }
    : {
        allowsEditing: false,
        preferredAssetRepresentationMode:
          picker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
  const result = await picker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    ...framing,
    quality: 0.9,
    exif: false,
    base64: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  if (asset.fileSize !== undefined && asset.fileSize > maxBytes) {
    throw new ImagePrecheckError('tooLarge');
  }
  if (asset.mimeType && !isAcceptedImageType(asset.mimeType)) {
    throw new ImagePrecheckError('formatUnsupported');
  }
  // локальный file:// → Blob (как трек заезда): fetch RN читает файл без base64 в JS
  const body = await (await fetch(asset.uri)).blob();
  if (body.size > maxBytes) throw new ImagePrecheckError('tooLarge');
  return { body };
}
