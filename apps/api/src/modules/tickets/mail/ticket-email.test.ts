import { describe, expect, it } from 'vitest';

import { renderTicketEmail } from './ticket-email';

const input = {
  event: {
    title: 'Кольцо <script>',
    startsAt: new Date('2026-11-01T07:00:00Z'),
    place: 'Парк «Победы»',
    address: 'ул. Ленина, 1 & 2',
    city: null,
  },
  code: '7XK2M9PQRT',
  category: { kind: 'race', tier: 'verified', groupKey: 'm_u40' } as const,
  instructions: 'Приходите за час.\nВозьмите <паспорт>.',
  link: 'https://pokatim.example/tickets/7XK2M9PQRT?a=1&b=2',
};

describe('письмо «Вы зарегистрированы» (AC7)', () => {
  it('тема, событие, дата по Минску, место, группа, код в показе, кнопка', () => {
    const mail = renderTicketEmail(input);
    expect(mail.subject).toBe('Вы зарегистрированы: Кольцо <script>');
    expect(mail.text).toContain('1 ноября 2026 г. в 10:00 по минскому времени');
    expect(mail.text).toContain('Где: Парк «Победы», ул. Ленина, 1 & 2');
    expect(mail.text).toContain('Группа: Мужчины до 40 · Verified');
    expect(mail.text).toContain('Код билета: 7XK2M-9PQRT');
    expect(mail.text).toContain(`Открыть билет: ${input.link}`);
    expect(mail.html).toContain('href="https://pokatim.example/tickets/7XK2M9PQRT?a=1&amp;b=2"');
  });

  it('HTML экранирует название, место и инструкции; перевод строки — <br>', () => {
    const { html } = renderTicketEmail(input);
    expect(html).not.toContain('<script>');
    expect(html).toContain('Кольцо &lt;script&gt;');
    expect(html).toContain('1 &amp; 2');
    expect(html).toContain('Приходите за час.<br>Возьмите &lt;паспорт&gt;.');
  });

  it('без ссылки — без кнопки, текст «в приложении»; дистанция календаря', () => {
    const mail = renderTicketEmail({
      ...input,
      link: null,
      category: { kind: 'calendar', distanceKm: 42.2 },
      instructions: null,
    });
    expect(mail.html).not.toContain('<a ');
    expect(mail.text).toContain('Билет — в приложении «Покатим».');
    expect(mail.text).toContain('Дистанция: 42,2 км');
    expect(mail.text).not.toContain('Инструкции');
  });
});

describe('письмо: материалы события (PR C)', () => {
  const materials = [
    {
      title: 'Положение <гонки>',
      description: null,
      url: 'https://pokatim.by/rules?a=1&b=2',
      file: null,
    },
    {
      title: 'Схема парковки',
      description: null,
      url: null,
      file: { id: 'F'.repeat(43), name: 'p.pdf', size: 10 },
    },
    { title: 'Сбор', description: 'В 9:00 у <арки>', url: null, file: null },
  ];

  it('ссылки и файлы — заголовок ссылкой (экранировано), текстовые — заголовок и описание', () => {
    const mail = renderTicketEmail({
      ...input,
      materials,
      fileBase: 'https://pokatim.example',
    });
    expect(mail.text).toContain('Материалы:');
    expect(mail.text).toContain('Положение <гонки>: https://pokatim.by/rules?a=1&b=2');
    expect(mail.text).toContain(
      `Схема парковки: https://pokatim.example/v1/event-files/${'F'.repeat(43)}`,
    );
    expect(mail.text).toContain('Сбор: В 9:00 у <арки>');
    expect(mail.html).toContain(
      '<a href="https://pokatim.by/rules?a=1&amp;b=2">Положение &lt;гонки&gt;</a>',
    );
    expect(mail.html).toContain(`href="https://pokatim.example/v1/event-files/${'F'.repeat(43)}"`);
    expect(mail.html).toContain('В 9:00 у &lt;арки&gt;');
    expect(mail.html).not.toContain('<арки>');
  });

  it('без origin — файлы не выводятся; без материалов — блока нет', () => {
    const noOrigin = renderTicketEmail({ ...input, materials, fileBase: null });
    expect(noOrigin.text).not.toContain('Схема парковки');
    expect(noOrigin.text).toContain('Положение <гонки>');
    expect(renderTicketEmail(input).text).not.toContain('Материалы:');
  });
});
