import { MS_IN_DAY } from '@/features/pwa-install/install-prompt-state';

import {
  PUSH_SOFT_PROMPT_SNOOZE_MS,
  parseSoftPromptSnooze,
  softPromptVisible,
} from './push-soft-prompt-state';

const NOW = new Date('2026-10-30T10:00:00Z').getTime();
const ask = { status: 'undetermined', canAskAgain: true } as const;
const base = { supported: true, permission: ask, snoozedAt: null, now: NOW };

describe('подсказка push: когда показывать', () => {
  it('отложка «Не сейчас» — 30 дней', () => {
    expect(PUSH_SOFT_PROMPT_SNOOZE_MS).toBe(30 * MS_IN_DAY);
  });

  it('поддержан, не спрашивали, не отложена — показываем', () => {
    expect(softPromptVisible(base)).toBe(true);
    // Android: первый отказ ещё позволяет спросить
    expect(
      softPromptVisible({ ...base, permission: { status: 'denied', canAskAgain: true } }),
    ).toBe(true);
  });

  it('пока что-то неизвестно (SSR, первый рендер, хранилище читается) — не показываем', () => {
    expect(softPromptVisible({ ...base, supported: null })).toBe(false);
    expect(softPromptVisible({ ...base, permission: null })).toBe(false);
    expect(softPromptVisible({ ...base, snoozedAt: undefined })).toBe(false);
  });

  it('нет поддержки, выдано, отказ навсегда — не показываем', () => {
    expect(softPromptVisible({ ...base, supported: false })).toBe(false);
    expect(
      softPromptVisible({ ...base, permission: { status: 'unavailable', canAskAgain: false } }),
    ).toBe(false);
    expect(
      softPromptVisible({
        ...base,
        permission: { status: 'granted', canAskAgain: false, subscription: 'missing' },
      }),
    ).toBe(false);
    expect(
      softPromptVisible({ ...base, permission: { status: 'denied', canAskAgain: false } }),
    ).toBe(false);
  });

  it('«Не сейчас» — 30 дней не показываем, потом снова', () => {
    const snoozedAt = NOW - PUSH_SOFT_PROMPT_SNOOZE_MS + 1;
    expect(softPromptVisible({ ...base, snoozedAt })).toBe(false);
    expect(softPromptVisible({ ...base, snoozedAt: snoozedAt - 1 })).toBe(true);
  });

  it('значение хранилища: нет или битое — отложки нет', () => {
    expect(parseSoftPromptSnooze({ snoozedAt: 42 })).toBe(42);
    expect(parseSoftPromptSnooze(null)).toBeUndefined();
    expect(parseSoftPromptSnooze({ snoozedAt: 'x' })).toBeUndefined();
    expect(parseSoftPromptSnooze('x')).toBeUndefined();
  });
});
