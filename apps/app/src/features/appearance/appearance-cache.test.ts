/// <reference types="jest" />
import * as SecureStore from 'expo-secure-store';

import { readCachedThemeId, saveCachedThemeId } from './appearance-cache';

const store = jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;

afterEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe('кэш темы приложения (native)', () => {
  it('запись и чтение pokatim.appTheme', async () => {
    expect(await readCachedThemeId()).toBeNull();
    await saveCachedThemeId('atlas');
    expect(store.get('pokatim.appTheme')).toBe('"atlas"');
    expect(await readCachedThemeId()).toBe('atlas');
  });

  it.each([['"unknown"'], ['not json'], ['42']])(
    'битое значение %s — удаляется, null',
    async (raw) => {
      store.set('pokatim.appTheme', raw);
      expect(await readCachedThemeId()).toBeNull();
      expect(store.has('pokatim.appTheme')).toBe(false);
    },
  );

  it('сбой записи — warn только с именем ошибки', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = new Error('keychain: secret details');
    failure.name = 'KeychainError';
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(failure);
    await saveCachedThemeId('atlas');
    expect(warn).toHaveBeenCalledWith('app theme not persisted: KeychainError');
    expect(String(warn.mock.calls[0])).not.toContain('secret details');
    warn.mockRestore();
  });
});
