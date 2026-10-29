import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** Подготовленная OG-картинка для «Поделиться» (native — PNG в кэше приложения). */
export interface ShareImage {
  uri: string;
}

/**
 * Картинка файлом вместе с текстом — только iOS: `Share.share({ url: file://…, message })` отдаёт листу и файл, и
 * текст. Android `Share` RN шлёт только текст (`url` не поддерживается), а `expo-sharing` — только файл без подписи:
 * там — прежняя ссылка (превью строит мессенджер). Картинку не готовим — лишней загрузки нет.
 */
export const shareImageSupported = (): boolean => Platform.OS === 'ios';

/** `og-<вид>-<id>-<версия>.png` из адреса `/v1/og/images/<вид>/<id>/<версия>.png`. */
const fileName = (url: string) =>
  `og-${url
    .split('/')
    .slice(-3)
    .join('-')
    .replace(/\.png$/, '')
    .replace(/[^A-Za-z0-9_-]/g, '')}.png`;

/** PNG → файл в кэше (`expo-file-system`, повтор перезаписывает); готовится заранее — лист открывается сразу. */
export async function prepareShareImage(url: string): Promise<ShareImage> {
  const file = await File.downloadFileAsync(url, new File(Paths.cache, fileName(url)), {
    idempotent: true,
  });
  return { uri: file.uri };
}
