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

  it('кнопка «Открыть билет» — только при ссылке; адрес и текст экранированы', () => {
    const body = '«Гонка» — 14 июня, 10:00.\nВозьмите <паспорт>.';
    const link = 'https://pokatim.test/tickets/7XK2M9PQRT';
    const mail = renderNotificationEmail({ title: 'Скоро старт', body }, link);
    expect(mail.subject).toBe('Скоро старт');
    expect(mail.text).toBe(`Здравствуйте!\n\n${body}\n\nОткрыть билет: ${link}`);
    expect(mail.html).toContain(`href="${link}"`);
    expect(mail.html).toContain('Открыть билет');
    expect(mail.html).toContain('Возьмите &lt;паспорт&gt;.');
    expect(mail.html).not.toContain(OPEN_APP_LINE);
    const plain = renderNotificationEmail({ title: 'Скоро старт', body }, null);
    expect(plain.html).not.toContain('href=');
    expect(plain.text).toContain(OPEN_APP_LINE);
  });
});
