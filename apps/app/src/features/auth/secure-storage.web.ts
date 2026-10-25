import type { SecureKey } from './secure-storage';

/** SSR (нет `window`) и запрет хранилища сайтом (Safari, политика) — хранилища нет, значения не читаются. */
function tabStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Web (R10, task.md F5b): `sessionStorage` — переживает перезагрузку вкладки, не делится между вкладками и
 * закрывается вместе с ней. Здесь токен регистрации и кеш «опрос пройден» (`pokatim.onboarding`, с владельцем —
 * дубликат вкладки или выход в другой вкладке чужой кеш не подсовывают); сессию web не хранит (refresh — httpOnly
 * cookie, access — в памяти, `session-persistence.web.ts`). Флаг геопозиции устройства — `localStorage`
 * (`device-flags.web.ts`). Сбой хранилища не бросает: сценарий идёт в памяти.
 */
export const secureStorage = {
  get: async (key: SecureKey): Promise<string | null> => {
    try {
      return tabStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set: async (key: SecureKey, value: string): Promise<void> => {
    try {
      tabStorage()?.setItem(key, value);
    } catch (error) {
      console.warn(`sessionStorage unavailable: ${(error as Error).name}`);
    }
  },
  delete: async (key: SecureKey): Promise<void> => {
    try {
      tabStorage()?.removeItem(key);
    } catch {
      // нечего удалять: хранилище недоступно
    }
  },
};
