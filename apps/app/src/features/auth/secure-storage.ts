import * as SecureStore from 'expo-secure-store';

/** Ключи хранилища (Keychain / Keystore допускают только `[A-Za-z0-9._-]`). */
export type SecureKey =
  'pokatim.session' | 'pokatim.registration' | 'pokatim.onboarding' | 'pokatim.locationPrompt';

/**
 * Единственная точка доступа к защищённому хранилищу: экраны и сторы не знают о нативном модуле;
 * web — `secure-storage.web.ts` (sessionStorage вкладки).
 */
export const secureStorage = {
  get: (key: SecureKey): Promise<string | null> => SecureStore.getItemAsync(key),
  set: (key: SecureKey, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  delete: (key: SecureKey): Promise<void> => SecureStore.deleteItemAsync(key),
};
