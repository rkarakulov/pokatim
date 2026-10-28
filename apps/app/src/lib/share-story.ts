import { ApiNetworkError } from '@pokatim/api-client';
import { requireOptionalNativeModule } from 'expo';
import { File, Paths } from 'expo-file-system';

import { downloadFile } from './download-file';
import { loadExpoSharing } from './load-expo-sharing';
import type { ShareOutcome } from './share-link';

/** Итог «Поделиться в сторис»: общий с `share-link` + «Скачать PNG» (нет системного листа с файлом). */
export type StoryShareOutcome = ShareOutcome | 'downloaded';
/** `share` — системный лист с файлом; `download` — скачать PNG (старый dev-клиент без `expo-sharing`, web без файлов). */
export type StoryShareMode = 'share' | 'download';

/** Подготовленная картинка карточки (native — файл в кэше, адрес — для режима «Скачать»). */
export interface StoryFile {
  url: string;
  uri: string;
}

/** `story-<токен>.png`: расширение снимается до очистки имени (иначе точка пропадала — `…png.png`). */
const fileName = (url: string) =>
  `story-${(url.split('/').pop() ?? 'card').replace(/\.png$/, '').replace(/[^A-Za-z0-9_-]/g, '')}.png`;

/**
 * PNG карточки → файл в кэше приложения (`expo-file-system`, уже в сборке как зависимость `expo`); повтор перезаписывает.
 * Готовится заранее, как только карточка готова: системный лист открывается сразу по нажатию.
 */
export async function prepareStory(url: string): Promise<StoryFile> {
  try {
    const file = await File.downloadFileAsync(url, new File(Paths.cache, fileName(url)), {
      idempotent: true,
    });
    return { url, uri: file.uri };
  } catch (error) {
    // загрузчик ОС: ответ сервера — «response has status N» (iOS), «… status: N» / «HTTP N» (Android);
    // остальное — обрыв сети (экран — «Нет соединения»)
    if (error instanceof Error && HTTP_STATUS.test(error.message)) throw error;
    throw new ApiNetworkError(error);
  }
}

/** Текст ошибки загрузчика `expo-file-system` с HTTP-статусом ответа. */
const HTTP_STATUS = /status:? \d{3}|HTTP \d{3}/;

/** Источник превью: native — файл кэша (освобождать нечего). */
export function storyPreviewSource(file: StoryFile): { uri: string; release: () => void } {
  return { uri: file.uri, release: () => undefined };
}

/** Нативного модуля `ExpoSharing` нет (сборка до story-cards, Expo Go) — режим «Скачать PNG» (RC-12). */
export function storyShareMode(_file: StoryFile): StoryShareMode {
  return requireOptionalNativeModule('ExpoSharing') ? 'share' : 'download';
}

/**
 * Native: системный лист с PNG (`expo-sharing`, импорт ленивый — модуль бросает при загрузке без нативной части):
 * «Сохранить в Фото», Instagram Stories — через лист. Нет модуля — PNG в системном браузере (`downloadFile`).
 */
export async function shareStory(
  file: StoryFile,
  dialogTitle?: string,
): Promise<StoryShareOutcome> {
  if (storyShareMode(file) === 'download') {
    await downloadFile(file.url);
    return 'downloaded';
  }
  const { shareAsync } = await loadExpoSharing();
  await shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
  return 'shared';
}
