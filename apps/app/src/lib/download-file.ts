import { openExternalUrl } from './open-external-url';

/**
 * Скачивание файла по адресу API (routes-03, RC-6) — native: системный браузер (`openExternalUrl`); файл с
 * `Content-Disposition: attachment` скачивает браузер, «Открыть в…»/«Файлы» — ОС. Только по нажатию; адрес не
 * логируется. Ошибка (нет браузера, отказ ОС) — отклонённый промис, экран показывает баннер.
 */
export function downloadFile(url: string): Promise<void> {
  return openExternalUrl(url);
}
