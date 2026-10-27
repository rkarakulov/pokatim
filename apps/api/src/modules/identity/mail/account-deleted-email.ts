import type { MailMessage } from '@rkarakulov/api-kit/core';

import { escapeHtml, htmlEmail } from './html';
import { minskDateTime } from './password-changed-email';

/**
 * Письмо «Аккаунт удалён» (A10): когда — по Минску; без имени, без ссылок с токенами и адреса приложения. Уходит до
 * стирания открытого e-mail (`AccountErasure.notifyAndErase`).
 */
export function renderAccountDeletedEmail({
  deletedAt,
}: {
  deletedAt: Date;
}): Omit<MailMessage, 'to'> {
  const when = `${minskDateTime.format(deletedAt)} по минскому времени`;
  const subject = 'Аккаунт удалён';
  const deleted = `Ваш аккаунт в «Покатим» удалён ${when}.`;
  const notYou = 'Если это были не вы — напишите нам.';
  const text = ['Здравствуйте!', '', deleted, '', notYou].join('\n');
  const html = htmlEmail(['Здравствуйте!', escapeHtml(deleted), escapeHtml(notYou)]);
  return { subject, html, text };
}
