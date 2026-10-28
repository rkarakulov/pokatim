/// <reference types="jest" />
import { i18n } from '@pokatim/i18n';

import { restoreLocale, saveLocale } from './locale-preference.web';

let setLocale: jest.SpyInstance;
beforeEach(() => {
  localStorage.clear();
  setLocale = jest.spyOn(i18n, 'setLocale');
});
afterEach(() => setLocale.mockRestore());

describe('язык на устройстве (web)', () => {
  it('выбор — в i18n и в localStorage; при запуске применяется', async () => {
    await saveLocale('ru');
    expect(localStorage.getItem('pokatim.locale')).toBe('"ru"');
    setLocale.mockClear();

    await restoreLocale();
    expect(setLocale).toHaveBeenCalledWith('ru');
  });

  it.each([
    ['язык не из сборки', '"de"'],
    ['не JSON', 'ru'],
  ])('%s — язык по умолчанию', async (_case, raw) => {
    localStorage.setItem('pokatim.locale', raw);
    await restoreLocale();
    expect(setLocale).not.toHaveBeenCalled();
  });

  it('хранилище недоступно — не падает', async () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    await expect(restoreLocale()).resolves.toBeUndefined();
    getItem.mockRestore();
  });
});
