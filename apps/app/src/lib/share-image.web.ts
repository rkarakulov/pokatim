/** Подготовленная OG-картинка для «Поделиться» (web — `File` для Web Share). */
export interface ShareImage {
  file: File;
}

const FILE_NAME = 'pokatim.png';

/** Web Share с файлами возможен (`navigator.canShare`) — иначе картинку не грузим, делимся ссылкой. */
export const shareImageSupported = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

/**
 * PNG → `File` заранее, до нажатия (RC-13): `navigator.share` должен вызываться синхронно в обработчике жеста — после
 * `await fetch` в обработчике жест уже потерян (Safari, Chrome).
 */
export async function prepareShareImage(url: string): Promise<ShareImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`share image: ${response.status}`);
  const blob = await response.blob();
  return { file: new File([blob], FILE_NAME, { type: 'image/png' }) };
}
