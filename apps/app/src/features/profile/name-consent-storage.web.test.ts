/// <reference types="jest" />
import { NAME_CONSENT_PROMPT_KEY } from './name-consent-state';
import { loadNameConsentSnooze, saveNameConsentSnooze } from './name-consent-storage';

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('пауза шита согласия (web)', () => {
  it('в localStorage: нет — null, после «Не сейчас» — время', async () => {
    await expect(loadNameConsentSnooze()).resolves.toBeNull();
    await saveNameConsentSnooze(42);
    await expect(loadNameConsentSnooze()).resolves.toBe(42);
    expect(JSON.parse(localStorage.getItem(NAME_CONSENT_PROMPT_KEY) ?? '{}')).toEqual({
      snoozedAt: 42,
    });
  });

  it('битое значение — паузы нет', async () => {
    localStorage.setItem(NAME_CONSENT_PROMPT_KEY, 'not json');
    await expect(loadNameConsentSnooze()).resolves.toBeNull();
    localStorage.setItem(NAME_CONSENT_PROMPT_KEY, '{"snoozedAt":"x"}');
    await expect(loadNameConsentSnooze()).resolves.toBeNull();
  });

  it('хранилище недоступно (приватный режим) — не бросает', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(saveNameConsentSnooze(42)).resolves.toBeUndefined();
    await expect(loadNameConsentSnooze()).resolves.toBeNull();
  });
});
