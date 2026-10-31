import { MS_IN_DAY } from '@/features/pwa-install/install-prompt-state';

import { NAME_HINT_SNOOZE_MS, nameHintVisible, parseNameHintSnooze } from './name-hint-state';

const NOW = new Date('2026-10-31T10:00:00Z').getTime();

describe('подсказка имени на Главной: когда показывать (K3)', () => {
  it('отложка «Не сейчас» — 14 дней', () => {
    expect(NAME_HINT_SNOOZE_MS).toBe(14 * MS_IN_DAY);
  });

  it('не откладывали — видна; хранилище читается — скрыта', () => {
    expect(nameHintVisible(null, NOW)).toBe(true);
    expect(nameHintVisible(undefined, NOW)).toBe(false);
  });

  it('отложка −14 дн + 1 мс — скрыта; ровно 14 дн — видна', () => {
    expect(nameHintVisible(NOW - NAME_HINT_SNOOZE_MS + 1, NOW)).toBe(false);
    expect(nameHintVisible(NOW - NAME_HINT_SNOOZE_MS, NOW)).toBe(true);
  });

  it('битое значение хранилища — отложки нет', () => {
    expect(parseNameHintSnooze({ snoozedAt: 42 })).toBe(42);
    expect(parseNameHintSnooze({ snoozedAt: 'x' })).toBeUndefined();
    expect(parseNameHintSnooze(null)).toBeUndefined();
  });
});
