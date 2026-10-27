import type { MailMessage } from '@rkarakulov/api-kit/core';

import { escapeHtml, htmlEmail } from './html';
import { minskDateTime } from './password-changed-email';

/**
 * Письмо «Аккаунт удалён» (A10): когда — по Минску; без имени, без ссылок с токенами и адреса приложения. Уходит до
 * стирания открытого e-mail (`AccountErasure.notifyAndErase`). Строка «если это были не вы» — только с адресом
 * поддержки (`SUPPORT_EMAIL`): письма уходят с no-reply.
 */
export function renderAccountDeletedEmail({
  deletedAt,
  supportEmail,
}: {
  deletedAt: Date;
  supportEmail?: string;
}): Omit<MailMessage, 'to'> {
  const when = `${minskDateTime.format(deletedAt)} по минскому времени`;
  const subject = 'Аккаунт удалён';
  const deleted = `Ваш аккаунт в «Покатим» удалён ${when}.`;
  const notYou = supportEmail ? [`Если это были не вы — напишите на ${supportEmail}.`] : [];
  const text = ['Здравствуйте!', '', deleted, ...notYou.flatMap((line) => ['', line])].join('\n');
  const html = htmlEmail(['Здравствуйте!', escapeHtml(deleted), ...notYou.map(escapeHtml)]);
  return { subject, html, text };
}
