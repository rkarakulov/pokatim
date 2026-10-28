/// <reference types="jest" />
import { i18n } from '@pokatim/i18n';

import { restoreLocale, saveLocale } from './locale-preference';

const store = () => jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;

let setLocale: jest.SpyInstance;
beforeEach(() => {
  setLocale = jest.spyOn(i18n, 'setLocale');
});
afterEach(() => setLocale.mockRestore());

describe('язык на устройстве (native)', () => {
  it('выбор — в i18n и в SecureStore; при запуске применяется', async () => {
    await saveLocale('ru');
    expect(store().get('pokatim.locale')).toBe('"ru"');
    setLocale.mockClear();

    await restoreLocale();
    expect(setLocale).toHaveBeenCalledWith('ru');
  });

  it.each([
    ['ничего не сохранено', undefined],
    ['язык не из сборки', '"de"'],
    ['не JSON', 'ru'],
  ])('%s — язык по умолчанию, мусор стирается', async (_case, raw) => {
    if (raw !== undefined) store().set('pokatim.locale', raw);
    await restoreLocale();
    expect(setLocale).not.toHaveBeenCalled();
    expect(store().has('pokatim.locale')).toBe(false);
  });
});
