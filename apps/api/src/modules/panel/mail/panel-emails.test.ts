import { describe, expect, it } from 'vitest';

import { renderInvitationEmail, renderRoleEmail } from './panel-emails';

const LINK = 'https://pokatim.example/admin/invite#token=abc';

describe('renderInvitationEmail', () => {
  it('роль, «действует до» по Минску, ссылка-кнопка; без имени пригласившего', () => {
    const mail = renderInvitationEmail({
      role: 'moderator',
      expiresAt: new Date('2026-11-06T10:00:00Z'),
      link: LINK,
    });
    expect(mail.subject).toBe('Приглашение в команду «Покатим»');
    expect(mail.text).toContain('Модератор');
    expect(mail.text).toContain('6 ноября 2026 г. в 13:00');
    expect(mail.text).toContain(LINK);
    expect(mail.html).toContain(`href="${LINK}"`);
    expect(mail.text).toContain('зарегистрируйтесь в приложении «Покатим» на этот адрес');
  });

  it('экранирует ссылку в HTML', () => {
    const mail = renderInvitationEmail({
      role: 'admin',
      expiresAt: new Date('2026-11-06T10:00:00Z'),
      link: 'https://x.example/admin/invite#token=a"b<c',
    });
    expect(mail.html).not.toContain('a"b<c');
    expect(mail.html).toContain('a&quot;b&lt;c');
  });
});

describe('renderRoleEmail', () => {
  it('выдача, смена, снятие — тексты по роли; кнопка «Открыть панель» от базы', () => {
    const granted = renderRoleEmail({
      action: 'granted',
      roleFrom: null,
      roleTo: 'organizer',
      link: 'https://p.example/admin/',
    });
    expect(granted.subject).toBe('Вам выдана роль в панели «Протокол»');
    expect(granted.text).toContain('Вам выдана роль «Организатор»');
    expect(granted.html).toContain('href="https://p.example/admin/"');
    expect(granted.html).toContain('Открыть панель');

    const changed = renderRoleEmail({
      action: 'changed',
      roleFrom: 'moderator',
      roleTo: 'admin',
      link: null,
    });
    expect(changed.text).toContain('Ваша роль изменена: «Модератор» → «Администратор»');
    expect(changed.html).not.toContain('Открыть панель');

    const revoked = renderRoleEmail({
      action: 'revoked',
      roleFrom: 'admin',
      roleTo: null,
      link: 'https://p.example/admin/',
    });
    expect(revoked.text).toContain('Ваша роль «Администратор» снята');
    expect(revoked.html).toContain('Открыть панель');
  });

  it('без причины: вход рендера не принимает её, текст не упоминает', () => {
    const mail = renderRoleEmail({
      action: 'revoked',
      roleFrom: 'organizer',
      roleTo: null,
      link: null,
    });
    expect(mail.text).not.toMatch(/причин/i);
  });
});
