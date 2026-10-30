import { parseSoftPromptSnooze, PUSH_SOFT_PROMPT_KEY } from './push-soft-prompt-state';

/**
 * Web: отложка подсказки push «Не сейчас» — в `localStorage` (как плашка установки PWA). SSR, приватный режим, запрет
 * хранилища — без отложки, не падаем: в этой сессии подсказка всё равно больше не показывается.
 */
export async function loadSoftPromptSnooze(): Promise<number | null> {
  try {
    const raw = globalThis.localStorage?.getItem(PUSH_SOFT_PROMPT_KEY);
    return raw ? (parseSoftPromptSnooze(JSON.parse(raw)) ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveSoftPromptSnooze(snoozedAt: number): Promise<void> {
  try {
    globalThis.localStorage?.setItem(PUSH_SOFT_PROMPT_KEY, JSON.stringify({ snoozedAt }));
  } catch (error) {
    console.warn(`localStorage unavailable: ${(error as Error).name}`);
  }
}
