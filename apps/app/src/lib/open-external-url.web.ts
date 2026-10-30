/**
 * Внешняя ссылка (сайт организатора) — новая вкладка без `window.opener` и без Referer (`noopener,noreferrer`):
 * защита от tabnabbing. `window.open` вызывается синхронно в обработчике нажатия, до любого `await`, — иначе
 * сработает блокировщик всплывающих окон. С `noopener` браузер всегда возвращает `null` — это не ошибка. Адрес не
 * логируется; исключение — отклонённый промис. `mailto:` и `geo:` (карты на Android) — приложение системы из текущей
 * вкладки (`window.open` оставил бы пустую вкладку).
 */
export function openExternalUrl(url: string): Promise<void> {
  try {
    if (url.startsWith('mailto:') || url.startsWith('geo:')) window.location.assign(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('open failed'));
  }
}
