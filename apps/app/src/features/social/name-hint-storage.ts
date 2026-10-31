import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

import { NAME_HINT_KEY, parseNameHintSnooze } from './name-hint-state';

/**
 * Отложка подсказки имени «Не сейчас» на устройстве (как отложка подсказки push): native — SecureStore, web —
 * `name-hint-storage.web.ts` (`localStorage`). Сбой хранилища — не падение: отложки нет, в этой сессии подсказка
 * всё равно скрыта.
 */
export async function loadNameHintSnooze(): Promise<number | null> {
  return (await readJson(NAME_HINT_KEY, parseNameHintSnooze)) ?? null;
}

export async function saveNameHintSnooze(snoozedAt: number): Promise<void> {
  try {
    await secureStorage.set(NAME_HINT_KEY, JSON.stringify({ snoozedAt }));
  } catch (error) {
    console.warn(`name hint snooze not persisted: ${(error as Error).name}`);
  }
}
