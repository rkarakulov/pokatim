import { Share } from 'react-native';

/** Итог «Поделиться»: отправлено, ссылка скопирована (web без Web Share), закрыто без отправки. */
export type ShareOutcome = 'shared' | 'copied' | 'dismissed';

export interface ShareLinkInput {
  title: string;
  /** Текст сообщения без ссылки — ссылку добавляет `shareLink`. */
  text: string;
  /** Путь публичной страницы (`/rides/<id>`) — ссылка всегда на собственный web-origin. */
  path: string;
}

/**
 * Native: origin ссылок — публичный `EXPO_PUBLIC_WEB_ORIGIN` сборки (адрес web-карточки); не задан (dev) —
 * поделиться нечем, кнопки нет.
 */
export function shareOrigin(): string | null {
  const origin = process.env.EXPO_PUBLIC_WEB_ORIGIN;
  return origin ? origin.replace(/\/$/, '') : null;
}

/** Системный share sheet (`Share` RN): текст и ссылка на web-карточку. */
export async function shareLink({ title, text, path }: ShareLinkInput): Promise<ShareOutcome> {
  const origin = shareOrigin();
  if (!origin) throw new Error('share origin is not configured');
  const url = `${origin}${path}`;
  const result = await Share.share({ title, message: `${text}\n${url}`, url });
  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
