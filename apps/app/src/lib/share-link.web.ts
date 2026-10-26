import type { ShareLinkInput, ShareOutcome } from './share-link';

export type { ShareLinkInput, ShareOutcome } from './share-link';

/** Web: origin — текущий сайт (`window.location.origin`); на SSR — `null` (кнопка появляется после монтирования). */
export function shareOrigin(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin;
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/**
 * Web Share API (мобильные браузеры), иначе — копирование ссылки в буфер (экран показывает «Ссылка скопирована»).
 * Закрытие системного окна (`AbortError`) — не ошибка.
 */
export async function shareLink({ title, text, path }: ShareLinkInput): Promise<ShareOutcome> {
  const origin = shareOrigin();
  if (!origin) throw new Error('share origin is not available');
  const url = `${origin}${path}`;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (error) {
      if (isAbort(error)) return 'dismissed';
      throw error;
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
