import type { ShareLinkInput as NativeShareLinkInput, ShareOutcome } from './share-link';
import type { ShareImage } from './share-image.web';
import { withInvite } from './share-invite';

export type { ShareOutcome } from './share-link';
export type ShareLinkInput = Omit<NativeShareLinkInput, 'image'> & { image?: ShareImage };

/** Web: origin — текущий сайт (`window.location.origin`); на SSR — `null` (кнопка появляется после монтирования). */
export function shareOrigin(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin;
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/** Данные Web Share: с картинкой, если браузер делится файлами, — файл и текст со ссылкой; иначе — текст и ссылка. */
function shareData({ title, text, image }: ShareLinkInput, url: string): ShareData {
  const files = image ? [image.file] : null;
  // Android Chrome с файлами игнорирует `url` — ссылка в тексте
  if (files && typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
    return { files, title, text: `${text}\n${url}` };
  }
  return { title, text, url };
}

/**
 * Web Share API (мобильные браузеры), иначе — копирование ссылки в буфер (экран показывает «Ссылка скопирована»).
 * `navigator.share` — синхронно, до любого `await` (жест пользователя; картинка подготовлена заранее). Закрытие
 * системного окна (`AbortError`) — не ошибка.
 */
export async function shareLink(input: ShareLinkInput): Promise<ShareOutcome> {
  const origin = shareOrigin();
  if (!origin) throw new Error('share origin is not available');
  // код приглашения вошедшего (P6): одно место для всех ссылок «Поделиться»
  const url = `${origin}${withInvite(input.path)}`;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(shareData(input, url));
      return 'shared';
    } catch (error) {
      if (isAbort(error)) return 'dismissed';
      throw error;
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
