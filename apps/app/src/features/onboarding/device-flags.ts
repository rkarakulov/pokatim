import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

import {
  LOCATION_PROMPT_KEY,
  LocationPromptFlag,
  type LocationPromptDecision,
} from './location-prompt';

/**
 * Флаг устройства «экран геопозиции показан» (Q5): переживает выход — экран один раз на устройство. Значение не
 * секретное; native — SecureStore (другой KV-зависимости в проекте нет), web — `device-flags.web.ts`
 * (`localStorage`). Сбой хранилища — не падение: экран покажется ещё раз (принято).
 */
export async function hasLocationPrompt(): Promise<boolean> {
  const flag = await readJson(LOCATION_PROMPT_KEY, (value) => {
    const parsed = LocationPromptFlag.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  });
  return flag !== undefined;
}

export async function saveLocationPrompt(decision: LocationPromptDecision): Promise<void> {
  try {
    await secureStorage.set(LOCATION_PROMPT_KEY, JSON.stringify({ decision, at: Date.now() }));
  } catch (error) {
    console.warn(`location prompt flag not persisted: ${(error as Error).name}`);
  }
}
