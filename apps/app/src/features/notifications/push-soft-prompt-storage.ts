import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

import { parseSoftPromptSnooze, PUSH_SOFT_PROMPT_KEY } from './push-soft-prompt-state';

/**
 * Отложка подсказки push «Не сейчас» на устройстве (переживает выход, как флаг геопозиции): native — SecureStore
 * (другой KV-зависимости нет), web — `push-soft-prompt-storage.web.ts` (`localStorage`). Сбой хранилища — не падение:
 * отложки нет, в этой сессии подсказка всё равно больше не показывается.
 */
export async function loadSoftPromptSnooze(): Promise<number | null> {
  return (await readJson(PUSH_SOFT_PROMPT_KEY, parseSoftPromptSnooze)) ?? null;
}

export async function saveSoftPromptSnooze(snoozedAt: number): Promise<void> {
  try {
    await secureStorage.set(PUSH_SOFT_PROMPT_KEY, JSON.stringify({ snoozedAt }));
  } catch (error) {
    console.warn(`push soft prompt snooze not persisted: ${(error as Error).name}`);
  }
}
