/**
 * Скачивание файла по адресу API (routes-03, RC-6) — web: переход по ссылке `<a download>` в той же вкладке
 * синхронно в обработчике нажатия (`Content-Disposition: attachment` — страница остаётся; новая вкладка Safari
 * оставила бы пустую). Без Referer и opener. Адрес не логируется; исключение — отклонённый промис.
 */
export function downloadFile(url: string): Promise<void> {
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error('download failed'));
  }
}
