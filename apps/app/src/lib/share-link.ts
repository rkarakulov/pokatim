import { Share } from 'react-native';

import type { ShareImage } from './share-image';

/** Итог «Поделиться»: отправлено, ссылка скопирована (web без Web Share), закрыто без отправки. */
export type ShareOutcome = 'shared' | 'copied' | 'dismissed';

export interface ShareLinkInput {
  title: string;
  /** Текст сообщения без ссылки — ссылку добавляет `shareLink`. */
  text: string;
  /** Путь публичной страницы (`/rides/<id>`) — ссылка всегда на собственный web-origin. */
  path: string;
  /**
   * OG-картинка страницы файлом (`prepareShareImage`, готовится заранее): мессенджер получает фото с подписью
   * независимо от превью ссылки. Нет (не готова, не загрузилась, платформа без файлов) — только текст и ссылка.
   */
  image?: ShareImage;
}

/**
 * Native: origin ссылок — публичный `EXPO_PUBLIC_WEB_ORIGIN` сборки (адрес web-карточки); не задан (dev) —
 * поделиться нечем, кнопки нет.
 */
export function shareOrigin(): string | null {
  const origin = process.env.EXPO_PUBLIC_WEB_ORIGIN;
  return origin ? origin.replace(/\/$/, '') : null;
}

/**
 * Системный share sheet (`Share` RN): текст и ссылка на web-карточку. С картинкой (только iOS, `shareImageSupported`)
 * — файл в `url`, ссылка остаётся в тексте `message`.
 */
export async function shareLink({
  title,
  text,
  path,
  image,
}: ShareLinkInput): Promise<ShareOutcome> {
  const origin = shareOrigin();
  if (!origin) throw new Error('share origin is not configured');
  const url = `${origin}${path}`;
  const result = await Share.share({ title, message: `${text}\n${url}`, url: image?.uri ?? url });
  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
