/// <reference types="jest" />
import { NAME_HINT_KEY } from './name-hint-state';
import { loadNameHintSnooze, saveNameHintSnooze } from './name-hint-storage';

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('отложка подсказки имени (web)', () => {
  it('в localStorage: нет — null, после «Не сейчас» — время', async () => {
    await expect(loadNameHintSnooze()).resolves.toBeNull();
    await saveNameHintSnooze(42);
    await expect(loadNameHintSnooze()).resolves.toBe(42);
    expect(JSON.parse(localStorage.getItem(NAME_HINT_KEY) ?? '{}')).toEqual({ snoozedAt: 42 });
  });

  it('битое значение — отложки нет', async () => {
    localStorage.setItem(NAME_HINT_KEY, 'not json');
    await expect(loadNameHintSnooze()).resolves.toBeNull();
    localStorage.setItem(NAME_HINT_KEY, '{"snoozedAt":"x"}');
    await expect(loadNameHintSnooze()).resolves.toBeNull();
  });

  it('хранилище недоступно (приватный режим) — не бросает', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(saveNameHintSnooze(42)).resolves.toBeUndefined();
    await expect(loadNameHintSnooze()).resolves.toBeNull();
  });
});
