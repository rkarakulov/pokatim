import { NAME_HINT_KEY, parseNameHintSnooze } from './name-hint-state';

/**
 * Web: отложка подсказки имени «Не сейчас» — в `localStorage` (как отложка подсказки push). SSR, приватный режим,
 * запрет хранилища — без отложки, не падаем: в этой сессии подсказка всё равно скрыта.
 */
export async function loadNameHintSnooze(): Promise<number | null> {
  try {
    const raw = globalThis.localStorage?.getItem(NAME_HINT_KEY);
    return raw ? (parseNameHintSnooze(JSON.parse(raw)) ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveNameHintSnooze(snoozedAt: number): Promise<void> {
  try {
    globalThis.localStorage?.setItem(NAME_HINT_KEY, JSON.stringify({ snoozedAt }));
  } catch (error) {
    console.warn(`localStorage unavailable: ${(error as Error).name}`);
  }
}
