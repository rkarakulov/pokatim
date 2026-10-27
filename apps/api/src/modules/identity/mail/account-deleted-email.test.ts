import { describe, expect, it } from 'vitest';

import { renderAccountDeletedEmail } from './account-deleted-email';

describe('renderAccountDeletedEmail', () => {
  // 21:05 UTC — уже следующий день по Минску (UTC+3)
  const deletedAt = new Date('2026-10-27T21:05:00.000Z');

  it('тема «Аккаунт удалён», дата удаления — по Минску, «если это были не вы»', () => {
    const mail = renderAccountDeletedEmail({ deletedAt });
    expect(mail.subject).toBe('Аккаунт удалён');
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('28 октября 2026');
      expect(body).toContain('00:05');
      expect(body).toContain('по минскому времени');
      expect(body).toContain('«Покатим»');
      expect(body).toContain('Если это были не вы');
    }
  });

  it('без ссылок и токенов, без адреса приложения', () => {
    const mail = renderAccountDeletedEmail({ deletedAt });
    for (const body of [mail.text, mail.html]) {
      expect(body).not.toMatch(/href=|https?:\/\/|pokatim:\/\/|exp:\/\//);
      expect(body).not.toMatch(/pokatim|on-?bike/i);
    }
  });
});
