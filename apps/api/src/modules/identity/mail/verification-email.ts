import type { MailMessage } from '@rkarakulov/api-kit/core';

import { buttonHtml, escapeHtml, htmlEmail } from './html';

/** Письмо «Подтвердите e-mail»: HTML с кнопкой и текстовая версия. Адресат подставляет Mailer. */
export function renderVerificationEmail({ link }: { link: string }): Omit<MailMessage, 'to'> {
  const href = escapeHtml(link);
  const subject = 'Подтвердите e-mail';
  const text = [
    'Здравствуйте!',
    '',
    'Чтобы завершить регистрацию в «Покатим», подтвердите адрес электронной почты по ссылке:',
    link,
    '',
    'Ссылка действует 24 часа. Если вы не регистрировались в «Покатим», просто проигнорируйте это письмо.',
  ].join('\n');
  const html = htmlEmail([
    'Здравствуйте!',
    'Чтобы завершить регистрацию в «Покатим», подтвердите адрес электронной почты.',
    buttonHtml(href, 'Подтвердить e-mail'),
    `Если кнопка не работает, откройте ссылку: <br /><a href="${href}">${href}</a>`,
    'Ссылка действует 24 часа. Если вы не регистрировались в «Покатим», просто проигнорируйте это письмо.',
  ]);
  return { subject, html, text };
}
