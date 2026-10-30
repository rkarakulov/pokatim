import type { MailMessage } from '@rkarakulov/api-kit/core';

import { buttonHtml, escapeHtml, htmlEmail } from '../identity';

/** Строка в конце письма: ссылки нет — `pokatim://` в почте на десктопе не открывается (task §7). */
export const OPEN_APP_LINE = 'Откройте приложение «Покатим».';

/**
 * Письмо уведомления (N2: «Решение по спору», «Райд отменён», напоминание о событии): тема — заголовок, текст —
 * снимок уведомления (без чужих ПДн, N12, строки — абзацами) и «Откройте приложение». Без токенов; ссылка — только
 * `link` (кнопка «Открыть билет» на `APP_WEB_ORIGIN`, PR D), иначе без ссылок.
 */
export function renderNotificationEmail(
  { title, body }: { title: string; body: string },
  link: string | null = null,
): Omit<MailMessage, 'to'> {
  const text = [
    'Здравствуйте!',
    '',
    body,
    '',
    link ? `Открыть билет: ${link}` : OPEN_APP_LINE,
  ].join('\n');
  const html = htmlEmail([
    'Здравствуйте!',
    ...body.split('\n').map(escapeHtml),
    link ? buttonHtml(escapeHtml(link), 'Открыть билет') : escapeHtml(OPEN_APP_LINE),
  ]);
  return { subject: title, text, html };
}
