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
  /** PR C: материалы события по порядку */
  materials?: readonly EmailMaterial[];
  /** `APP_WEB_ORIGIN` для ссылок на PDF (`/v1/event-files/<id>`); нет — PDF не выводятся */
  fileBase?: string | null;
}

export interface EmailMaterial {
  title: string;
  description: string | null;
  url: string | null;
  file: { id: string } | null;
}

/** Строки блока «Материалы»: ссылка (URL или PDF через origin) или текст; PDF без origin — пропуск. */
function materialLines(
  materials: readonly EmailMaterial[],
  fileBase: string | null,
): { text: string; html: string }[] {
  return materials.flatMap((material) => {
    const href = material.file
      ? fileBase
        ? `${fileBase}/v1/event-files/${encodeURIComponent(material.file.id)}`
        : null
      : material.url;
    if (material.file && href === null) return [];
    if (href !== null) {
      return [
        {
          text: `${material.title}: ${href}`,
          html: `<a href="${escapeHtml(href)}">${escapeHtml(material.title)}</a>`,
        },
      ];
    }
    const description = material.description ?? '';
    return [
      {
        text: `${material.title}: ${description}`,
        html: `${escapeHtml(material.title)}: ${escapeHtml(description).replaceAll('\n', '<br>')}`,
      },
    ];
  });
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
 * инструкции организатора, материалы (PR C: ссылки; PDF — через `APP_WEB_ORIGIN`). Без QR и QR-токена: билет открывается после входа (T2).
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
  const materials = materialLines(input.materials ?? [], input.fileBase ?? null);
  const text = [
    'Здравствуйте!',
    '',
    ...facts,
    '',
    input.link ? `Открыть билет: ${input.link}` : noLink,
    ...(instructions.length > 0 ? ['', ...instructions] : []),
    ...(materials.length > 0 ? ['', 'Материалы:', ...materials.map((line) => line.text)] : []),
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
    ...(materials.length > 0
      ? [escapeHtml('Материалы:'), materials.map((line) => line.html).join('<br>')]
      : []),
  ]);
  return { subject, html, text };
}
