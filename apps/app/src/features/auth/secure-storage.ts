import * as SecureStore from 'expo-secure-store';

/** Ключи хранилища (Keychain / Keystore допускают только `[A-Za-z0-9._-]`). */
export type SecureKey =
  | 'pokatim.session'
  | 'pokatim.registration'
  | 'pokatim.onboarding'
  | 'pokatim.locationPrompt'
  | 'pokatim.appTheme'
  | 'pokatim.pushToken'
  // отложка подсказки push «Не сейчас» (не секрет; другой KV-зависимости нет, как `pokatim.locationPrompt`)
  | 'pokatim.pushSoftPrompt'
  // пауза шита «Как вас показывать в результатах?» (name-consent-prompt, N3; не секрет)
  | 'pokatim.nameConsentPrompt'
  | 'pokatim.locale'
  // QR офлайн-копий билетов (event-tickets, plan-B §5): только токены QR и владелец — остальное в файле
  | 'pokatim.ticketQr'
  // отложка подсказки имени «Не сейчас» на Главной («Свои», K3; не секрет, как `pokatim.pushSoftPrompt`)
  | 'pokatim.nameHint';

/**
 * Единственная точка доступа к защищённому хранилищу: экраны и сторы не знают о нативном модуле;
 * web — `secure-storage.web.ts` (sessionStorage вкладки).
 */
export const secureStorage = {
  get: (key: SecureKey): Promise<string | null> => SecureStore.getItemAsync(key),
  set: (key: SecureKey, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  delete: (key: SecureKey): Promise<void> => SecureStore.deleteItemAsync(key),
};
