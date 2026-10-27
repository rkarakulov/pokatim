import { describe, expect, it } from 'vitest';

import { OPEN_APP_LINE, renderNotificationEmail } from './notification-email';

describe('renderNotificationEmail', () => {
  const notice = { title: 'Райд отменён', body: '«Кофе <b>& море</b>» 14 июня, 10:00 отменён.' };

  it('тема — заголовок, текст — снимок и «Откройте приложение «Покатим»»', () => {
    const mail = renderNotificationEmail(notice);
    expect(mail.subject).toBe('Райд отменён');
    expect(mail.text).toBe(`Здравствуйте!\n\n${notice.body}\n\n${OPEN_APP_LINE}`);
    expect(mail.html).toContain(OPEN_APP_LINE);
  });

  it('HTML экранирован; без ссылок', () => {
    const mail = renderNotificationEmail(notice);
    expect(mail.html).toContain('«Кофе &lt;b&gt;&amp; море&lt;/b&gt;»');
    expect(mail.html).not.toContain('<b>');
    for (const body of [mail.text, mail.html]) {
      expect(body).not.toMatch(/href=|https?:\/\/|pokatim:\/\/|exp:\/\//);
    }
  });
});
