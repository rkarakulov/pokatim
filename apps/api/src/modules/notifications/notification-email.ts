import type { MailMessage } from '@rkarakulov/api-kit/core';

import { escapeHtml, htmlEmail } from '../identity';

/** Строка в конце письма: ссылки нет — `pokatim://` в почте на десктопе не открывается (task §7). */
export const OPEN_APP_LINE = 'Откройте приложение «Покатим».';

/**
 * Письмо уведомления (N2: «Решение по спору», «Райд отменён»): тема — заголовок, текст — снимок уведомления (без
 * чужих ПДн, N12) и «Откройте приложение». Без ссылок и токенов.
 */
export function renderNotificationEmail({
  title,
  body,
}: {
  title: string;
  body: string;
}): Omit<MailMessage, 'to'> {
  const text = ['Здравствуйте!', '', body, '', OPEN_APP_LINE].join('\n');
  const html = htmlEmail(['Здравствуйте!', escapeHtml(body), escapeHtml(OPEN_APP_LINE)]);
  return { subject: title, text, html };
}
