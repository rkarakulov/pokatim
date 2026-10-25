import {
  LOCATION_PROMPT_KEY,
  LocationPromptFlag,
  type LocationPromptDecision,
} from './location-prompt';

/**
 * Web: флаг «экран геопозиции показан» — в `localStorage` (переживает вкладки, перезапуск браузера и выход).
 * SSR, приватный режим, запрет хранилища — без флага, не падаем: экран может показаться снова (принято).
 */
export async function hasLocationPrompt(): Promise<boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(LOCATION_PROMPT_KEY);
    if (!raw) return false;
    return LocationPromptFlag.safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
}

export async function saveLocationPrompt(decision: LocationPromptDecision): Promise<void> {
  try {
    globalThis.localStorage?.setItem(
      LOCATION_PROMPT_KEY,
      JSON.stringify({ decision, at: Date.now() }),
    );
  } catch (error) {
    console.warn(`localStorage unavailable: ${(error as Error).name}`);
  }
}
