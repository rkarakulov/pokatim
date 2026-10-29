import { formatTicketCode } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import type { MailMessage } from '@rkarakulov/api-kit/core';

import { buttonHtml, escapeHtml, htmlEmail, minskDateTime } from '../../identity';
import type { TicketCategoryDoc } from '../tickets.collection';

export interface TicketEmailInput {
  event: {
    title: string;
    startsAt: Date;
    place: string | null;
    address: string | null;
    city: string | null;
  };
  code: string;
  category: TicketCategoryDoc | null;
  instructions: string | null;
  /** `${APP_WEB_ORIGIN}/tickets/<код>`; нет origin — `null` (без кнопки) */
  link: string | null;
}

const distance = (km: number) => `${String(km).replace('.', ',')} км`;

function categoryLine(category: TicketCategoryDoc | null): string | null {
  if (category === null) return null;
  if (category.kind === 'calendar') {
    return category.distanceKm === null ? null : `Дистанция: ${distance(category.distanceKm)}`;
  }
  return `Группа: ${t(`results.group.${category.groupKey}`)} · ${t(`results.tier.${category.tier}`)}`;
}

/**
 * Письмо «Вы зарегистрированы» (event-tickets, транзакционное — настройки уведомлений не влияют): событие, дата и
 * время по Минску, место, группа или дистанция, код билета, кнопка «Открыть билет» (только при `APP_WEB_ORIGIN`),
 * инструкции организатора. Без QR и QR-токена: билет открывается после входа (T2).
 */
export function renderTicketEmail(input: TicketEmailInput): Omit<MailMessage, 'to'> {
  const { event } = input;
  const subject = `Вы зарегистрированы: ${event.title}`;
  const where = [event.place, event.address, event.city].filter((part) => part !== null).join(', ');
  const facts = [
    `Вы зарегистрированы на «${event.title}».`,
    `Когда: ${minskDateTime.format(event.startsAt)} по минскому времени`,
    ...(where ? [`Где: ${where}`] : []),
    ...[categoryLine(input.category)].filter((line): line is string => line !== null),
    `Код билета: ${formatTicketCode(input.code)}`,
  ];
  const noLink = 'Билет — в приложении «Покатим».';
  const instructions = input.instructions ? ['Инструкции организатора:', input.instructions] : [];
  const text = [
    'Здравствуйте!',
    '',
    ...facts,
    '',
    input.link ? `Открыть билет: ${input.link}` : noLink,
    ...(instructions.length > 0 ? ['', ...instructions] : []),
  ].join('\n');
  const html = htmlEmail([
    'Здравствуйте!',
    ...facts.map(escapeHtml),
    input.link ? buttonHtml(escapeHtml(input.link), 'Открыть билет') : escapeHtml(noLink),
    ...(input.instructions
      ? [
          escapeHtml('Инструкции организатора:'),
          escapeHtml(input.instructions).replaceAll('\n', '<br>'),
        ]
      : []),
  ]);
  return { subject, html, text };
}
