import type { MailMessage } from '@rkarakulov/api-kit/core';

import { buttonHtml, escapeHtml, htmlEmail } from './html';

const EXPIRY = 'Ссылка действует 1 час.';
const IGNORE = 'Если вы не запрашивали сброс, проигнорируйте письмо — пароль не изменится.';

/** Письмо «Восстановление пароля»: ссылка на экран нового пароля. Адресат подставляет Mailer. */
export function renderPasswordResetEmail({ link }: { link: string }): Omit<MailMessage, 'to'> {
  const href = escapeHtml(link);
  const subject = 'Восстановление пароля';
  const text = [
    'Здравствуйте!',
    '',
    'Вы запросили восстановление пароля в «Покатим». Задайте новый пароль по ссылке:',
    link,
    '',
    `${EXPIRY} ${IGNORE}`,
  ].join('\n');
  const html = htmlEmail([
    'Здравствуйте!',
    'Вы запросили восстановление пароля в «Покатим».',
    buttonHtml(href, 'Задать новый пароль'),
    `Если кнопка не работает, откройте ссылку: <br /><a href="${href}">${href}</a>`,
    `${EXPIRY} ${IGNORE}`,
  ]);
  return { subject, html, text };
}
