import type { StoryShareMode, StoryShareOutcome } from './share-story';

export type { StoryShareMode, StoryShareOutcome } from './share-story';

/** Подготовленная картинка карточки (web — `File` для Web Share и скачивания). */
export interface StoryFile {
  url: string;
  file: File;
}

const FILE_NAME = 'pokatim-story.png';

/**
 * PNG карточки → `File` заранее, как только карточка готова (RC-13): Safari требует `navigator.share` в пределах
 * жеста пользователя — после `await fetch` в обработчике жест уже потерян.
 */
export async function prepareStory(url: string): Promise<StoryFile> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`story image: ${response.status}`);
  const blob = await response.blob();
  return { url, file: new File([blob], FILE_NAME, { type: 'image/png' }) };
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
      URL.revokeObjectURL(href);
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
