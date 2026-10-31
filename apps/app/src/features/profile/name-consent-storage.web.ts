import { NAME_CONSENT_PROMPT_KEY, parseNameConsentSnooze } from './name-consent-state';

/**
 * Web: пауза шита согласия — в `localStorage` (как отложка подсказки push). SSR, приватный режим, запрет хранилища —
 * без паузы, не падаем: в этом запуске шит всё равно больше не показывается.
 */
export async function loadNameConsentSnooze(): Promise<number | null> {
  try {
    const raw = globalThis.localStorage?.getItem(NAME_CONSENT_PROMPT_KEY);
    return raw ? (parseNameConsentSnooze(JSON.parse(raw)) ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveNameConsentSnooze(snoozedAt: number): Promise<void> {
  try {
    globalThis.localStorage?.setItem(NAME_CONSENT_PROMPT_KEY, JSON.stringify({ snoozedAt }));
  } catch (error) {
    console.warn(`localStorage unavailable: ${(error as Error).name}`);
  }
}
