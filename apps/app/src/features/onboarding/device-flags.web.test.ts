/// <reference types="jest" />
import { hasLocationPrompt, saveLocationPrompt } from './device-flags';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  jest.restoreAllMocks();
});

describe('флаг геопозиции устройства (web)', () => {
  it('в localStorage (переживает вкладки и выход), не в sessionStorage', async () => {
    await expect(hasLocationPrompt()).resolves.toBe(false);
    await saveLocationPrompt('dismissed');

    await expect(hasLocationPrompt()).resolves.toBe(true);
    expect(JSON.parse(localStorage.getItem('pokatim.locationPrompt') ?? '{}')).toMatchObject({
      decision: 'dismissed',
    });
    expect(sessionStorage.length).toBe(0);
  });

  it('битое значение — флага нет', async () => {
    localStorage.setItem('pokatim.locationPrompt', '{"decision":"maybe"}');
    await expect(hasLocationPrompt()).resolves.toBe(false);
    localStorage.setItem('pokatim.locationPrompt', 'not json');
    await expect(hasLocationPrompt()).resolves.toBe(false);
  });

  it('хранилище недоступно (приватный режим) — не бросает', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(saveLocationPrompt('requested')).resolves.toBeUndefined();
    await expect(hasLocationPrompt()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('localStorage unavailable: QuotaExceededError');
  });
});
