import type { MailMessage } from '@rkarakulov/api-kit/core';

import { escapeHtml, htmlEmail } from './html';

/** Время в письмах — по Минску (AGENTS.md §4.7), в БД — UTC. */
const minskDateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Minsk',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Уведомление «Пароль изменён» (Q3 слайса 3): когда — по Минску; без ссылки с токеном и без адреса приложения —
 * письмо не должно само давать доступ, если ящик в чужих руках.
 */
export function renderPasswordChangedEmail({
  changedAt,
}: {
  changedAt: Date;
}): Omit<MailMessage, 'to'> {
  const when = `${minskDateTime.format(changedAt)} по минскому времени`;
  const subject = 'Пароль изменён';
  const changed = `Пароль вашего аккаунта в «Покатим» изменён ${when}. На всех устройствах выполнен выход.`;
  const notYou = 'Если это были не вы, восстановите пароль через «Забыли пароль?» на экране входа.';
  const text = ['Здравствуйте!', '', changed, '', notYou].join('\n');
  const html = htmlEmail(['Здравствуйте!', escapeHtml(changed), escapeHtml(notYou)]);
  return { subject, html, text };
}
