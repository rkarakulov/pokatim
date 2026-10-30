/// <reference types="jest" />
import { loadSoftPromptSnooze, saveSoftPromptSnooze } from './push-soft-prompt-storage';
import { PUSH_SOFT_PROMPT_KEY } from './push-soft-prompt-state';

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('отложка подсказки push (web)', () => {
  it('в localStorage: нет — null, после «Не сейчас» — время', async () => {
    await expect(loadSoftPromptSnooze()).resolves.toBeNull();
    await saveSoftPromptSnooze(42);
    await expect(loadSoftPromptSnooze()).resolves.toBe(42);
    expect(JSON.parse(localStorage.getItem(PUSH_SOFT_PROMPT_KEY) ?? '{}')).toEqual({
      snoozedAt: 42,
    });
  });

  it('битое значение — отложки нет', async () => {
    localStorage.setItem(PUSH_SOFT_PROMPT_KEY, 'not json');
    await expect(loadSoftPromptSnooze()).resolves.toBeNull();
    localStorage.setItem(PUSH_SOFT_PROMPT_KEY, '{"snoozedAt":"x"}');
    await expect(loadSoftPromptSnooze()).resolves.toBeNull();
  });

  it('хранилище недоступно (приватный режим) — не бросает', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(saveSoftPromptSnooze(42)).resolves.toBeUndefined();
    await expect(loadSoftPromptSnooze()).resolves.toBeNull();
  });
});
