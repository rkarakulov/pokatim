import { z } from 'zod';

import { MS_IN_DAY } from '@/features/pwa-install/install-prompt-state';

import type { PushPermissionState } from './push';

/** Ключ отложки подсказки push на устройстве (native — SecureStore, web — `localStorage`). */
export const PUSH_SOFT_PROMPT_KEY = 'pokatim.pushSoftPrompt';

/** Сколько подсказка не показывается после «Не сейчас» (решение 2026-10-30). */
export const PUSH_SOFT_PROMPT_SNOOZE_MS = 30 * MS_IN_DAY;

/** Где польза очевидна: после «Я иду» на райде и после записи на гонку. */
export type SoftPromptContext = 'ride' | 'race';

const StoredSnooze = z.object({ snoozedAt: z.number() });

/** Время «Не сейчас» из значения хранилища; нет или испорчено — `undefined` (отложки нет). */
export function parseSoftPromptSnooze(value: unknown): number | undefined {
  const parsed = StoredSnooze.safeParse(value);
  return parsed.success ? parsed.data.snoozedAt : undefined;
}

export interface SoftPromptInput {
  /** `usePushSupported()`: `null` — ещё неизвестно */
  supported: boolean | null;
  /** `null` — ещё проверяется */
  permission: PushPermissionState | null;
  /** время «Не сейчас»: `null` — не откладывали, `undefined` — хранилище ещё читается */
  snoozedAt: number | null | undefined;
  now: number;
}

/**
 * Показать подсказку: push поддержан, системный запрос ещё можно показать (не выдано, не отказ навсегда), не отложена
 * «Не сейчас» за последние 30 дней. Что-то неизвестно (SSR, первый рендер) — нет: без мигания.
 */
export function softPromptVisible({
  supported,
  permission,
  snoozedAt,
  now,
}: SoftPromptInput): boolean {
  if (supported !== true || !permission || snoozedAt === undefined) return false;
  const { status, canAskAgain } = permission;
  if (status === 'granted' || status === 'unavailable') return false;
  if (status === 'denied' && !canAskAgain) return false;
  return snoozedAt === null || now - snoozedAt >= PUSH_SOFT_PROMPT_SNOOZE_MS;
}
