import { ApiNetworkError } from '@pokatim/api-client';

import type { StoryShareMode, StoryShareOutcome } from './share-story';

export type { StoryShareMode, StoryShareOutcome } from './share-story';

/** Подготовленная картинка карточки (web — `File` для Web Share и скачивания). */
export interface StoryFile {
  url: string;
  file: File;
}

const FILE_NAME = 'pokatim-story.png';
/** Пауза перед отзывом blob-ссылки скачивания, мс. */
const REVOKE_DELAY_MS = 1000;

/**
 * PNG карточки → `File` заранее, как только карточка готова (RC-13): Safari требует `navigator.share` в пределах
 * жеста пользователя — после `await fetch` в обработчике жест уже потерян.
 */
export async function prepareStory(url: string): Promise<StoryFile> {
  // транспорт (fetch, чтение тела) — «Нет соединения»; ответ сервера с ошибкой — «Не удалось загрузить»
  const response = await fetch(url).catch((error: unknown) => {
    throw new ApiNetworkError(error);
  });
  if (!response.ok) throw new Error(`story image: ${response.status}`);
  const blob = await response.blob().catch((error: unknown) => {
    throw new ApiNetworkError(error);
  });
  return { url, file: new File([blob], FILE_NAME, { type: 'image/png' }) };
}

/** Источник превью: object URL подготовленного файла; `release` — отзыв при размонтировании. */
export function storyPreviewSource(story: StoryFile): { uri: string; release: () => void } {
  const uri = URL.createObjectURL(story.file);
  return { uri, release: () => URL.revokeObjectURL(uri) };
}

/** Web Share с файлами (мобильные браузеры) — `share`, иначе — «Скачать PNG». */
export function storyShareMode({ file }: StoryFile): StoryShareMode {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
    ? 'share'
    : 'download';
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/**
 * Web: `navigator.share({ files })` — без `await` до вызова (жест пользователя); закрытие окна (`AbortError`) — не
 * ошибка. Без Web Share файлов — скачивание `<a download>` по blob.
 */
export async function shareStory(
  story: StoryFile,
  _dialogTitle?: string,
): Promise<StoryShareOutcome> {
  if (storyShareMode(story) === 'download') {
    const href = URL.createObjectURL(story.file);
    try {
      const link = document.createElement('a');
      link.href = href;
      link.download = FILE_NAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      // синхронный отзыв после `click()` в части браузеров обрывает скачивание — после старта
      setTimeout(() => URL.revokeObjectURL(href), REVOKE_DELAY_MS);
    }
    return 'downloaded';
  }
  try {
    await navigator.share({ files: [story.file] });
    return 'shared';
  } catch (error) {
    if (isAbort(error)) return 'dismissed';
    throw error;
  }
}
