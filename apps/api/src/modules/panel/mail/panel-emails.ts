import type { PanelRole } from '@pokatim/contracts';
import type { MailMessage } from '@rkarakulov/api-kit/core';

import { buttonHtml, escapeHtml, htmlEmail, minskDateTime } from '../../identity';

/** Подписи ролей писем — серверный снимок (как тексты уведомлений), совпадают с `admin.role.*` панели. */
export const PANEL_ROLE_LABELS: Record<PanelRole, string> = {
  admin: 'Администратор',
  moderator: 'Модератор',
  organizer: 'Организатор',
};

const label = (role: PanelRole) => `«${PANEL_ROLE_LABELS[role]}»`;

/**
 * Письмо-приглашение в команду (ADR-0026): роль, срок по Минску, кнопка «Принять приглашение» (ссылка с токеном во
 * фрагменте), подсказка о регистрации в приложении. Без имени пригласившего и имени в панели.
 */
export function renderInvitationEmail(input: {
  role: PanelRole;
  expiresAt: Date;
  link: string;
}): Omit<MailMessage, 'to'> {
  const subject = 'Приглашение в команду «Покатим»';
  const facts = [
    `Вас пригласили в команду платформы «Покатим» с ролью ${label(input.role)} в панели «Протокол».`,
    `Приглашение действует до ${minskDateTime.format(input.expiresAt)} по минскому времени.`,
  ];
  const hint =
    'Нет аккаунта? Сначала зарегистрируйтесь в приложении «Покатим» на этот адрес и подтвердите e-mail, затем вернитесь по ссылке и войдите своим паролем.';
  const notYou = 'Если вы не ждали приглашения, просто проигнорируйте письмо.';
  const text = [
    'Здравствуйте!',
    '',
    ...facts,
    '',
    `Принять приглашение: ${input.link}`,
    '',
    hint,
    notYou,
  ].join('\n');
  const html = htmlEmail([
    'Здравствуйте!',
    ...facts.map(escapeHtml),
    buttonHtml(escapeHtml(input.link), 'Принять приглашение'),
    escapeHtml(hint),
    escapeHtml(notYou),
  ]);
  return { subject, html, text };
}

export type RoleEmailAction = 'granted' | 'changed' | 'revoked';

/**
 * Письмо сотруднику о роли: выдана, изменена, снята. Без причины (её пишет админ для журнала) и без имён. Кнопка
 * «Открыть панель» — при известной базе ссылок панели.
 */
export function renderRoleEmail(input: {
  action: RoleEmailAction;
  roleFrom: PanelRole | null;
  roleTo: PanelRole | null;
  link: string | null;
}): Omit<MailMessage, 'to'> {
  const { subject, line } = roleLines(input);
  const text = [
    'Здравствуйте!',
    '',
    line,
    ...(input.link ? ['', `Открыть панель: ${input.link}`] : []),
  ].join('\n');
  const html = htmlEmail([
    'Здравствуйте!',
    escapeHtml(line),
    ...(input.link ? [buttonHtml(escapeHtml(input.link), 'Открыть панель')] : []),
  ]);
  return { subject, html, text };
}

function roleLines(input: {
  action: RoleEmailAction;
  roleFrom: PanelRole | null;
  roleTo: PanelRole | null;
}): { subject: string; line: string } {
  const panel = 'в панели «Протокол» платформы «Покатим»';
  switch (input.action) {
    case 'granted':
      return {
        subject: 'Вам выдана роль в панели «Протокол»',
        line: `Вам выдана роль ${label(input.roleTo ?? 'organizer')} ${panel}.`,
      };
    case 'changed':
      return {
        subject: 'Ваша роль в панели «Протокол» изменена',
        line: `Ваша роль изменена: ${label(input.roleFrom ?? 'organizer')} → ${label(input.roleTo ?? 'organizer')} ${panel}.`,
      };
    case 'revoked':
      return {
        subject: 'Ваша роль в панели «Протокол» снята',
        line: `Ваша роль ${label(input.roleFrom ?? 'organizer')} снята ${panel}.`,
      };
  }
}
