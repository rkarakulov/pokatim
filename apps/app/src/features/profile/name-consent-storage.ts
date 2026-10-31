import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

import { NAME_CONSENT_PROMPT_KEY, parseNameConsentSnooze } from './name-consent-state';

/**
 * Пауза шита согласия на устройстве (переживает выход, как подсказка push): native — SecureStore, web —
 * `name-consent-storage.web.ts` (`localStorage`). Сбой хранилища — без паузы, не падение: в этом запуске шит всё равно
 * больше не показывается.
 */
export async function loadNameConsentSnooze(): Promise<number | null> {
  return (await readJson(NAME_CONSENT_PROMPT_KEY, parseNameConsentSnooze)) ?? null;
}

export async function saveNameConsentSnooze(snoozedAt: number): Promise<void> {
  try {
    await secureStorage.set(NAME_CONSENT_PROMPT_KEY, JSON.stringify({ snoozedAt }));
  } catch (error) {
    console.warn(`name consent snooze not persisted: ${(error as Error).name}`);
  }
}
