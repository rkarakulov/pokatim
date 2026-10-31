import { baseMessages } from '@rkarakulov/i18n-core';
import { describe, expect, it } from 'vitest';

import { i18n, localeNames, messages, t } from './index.ts';
import { ru } from './ru.ts';

describe('t', () => {
  it('возвращает строку pokatim по ключу', () => {
    expect(t('tabs.home')).toBe('Главная');
  });

  it('название продукта — бренд «Покатим»', () => {
    expect(t('app.name')).toBe('Покатим');
  });

  it('строки базы доступны через тот же t', () => {
    expect(t('state.retry')).toBe('Повторить');
    expect(t('date.long', { day: 14, month: t('date.month.3'), year: 1991 })).toBe('14 марта 1991');
  });

  it('плейсхолдеры подставляются, как раньше', () => {
    expect(t('auth.field.TOO_SHORT', { min: 8 })).toBe('Не короче 8 символов.');
  });

  it('срок приглашения в команду склоняется по числу дней', () => {
    const lead = (count: number) => t('admin.members.inviteLead', { count });
    expect(lead(1)).toContain('Ссылка действует 1 день.');
    expect(lead(3)).toContain('Ссылка действует 3 дня.');
    expect(lead(7)).toContain('Ссылка действует 7 дней.');
    expect(lead(21)).toContain('Ссылка действует 21 день.');
  });
});

describe('словарь pokatim', () => {
  it('не повторяет строки базы: ключ базы с тем же текстом — дубль', () => {
    const base: Record<string, unknown> = baseMessages.ru;
    const duplicates = Object.entries(ru)
      .filter(([key, text]) => base[key] === text)
      .map(([key]) => key);
    expect(duplicates).toEqual([]);
  });

  it('слит с базой: все ключи базы и pokatim', () => {
    expect(Object.keys(messages)).toEqual(
      expect.arrayContaining([...Object.keys(baseMessages.ru), ...Object.keys(ru)]),
    );
  });
});

describe('языки интерфейса', () => {
  it('у каждого языка есть имя на самом языке (экран «Язык»)', () => {
    expect(i18n.locales.map((locale) => localeNames[locale])).toEqual(['Русский']);
  });
});
