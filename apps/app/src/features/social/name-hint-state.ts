import { z } from 'zod';

import { MS_IN_DAY } from '@/features/pwa-install/install-prompt-state';

/** Ключ отложки подсказки имени на Главной (native — SecureStore, web — `localStorage`). */
export const NAME_HINT_KEY = 'pokatim.nameHint';

/** Сколько подсказка «Добавьте имя» не показывается на Главной после «Не сейчас» (K3). */
export const NAME_HINT_SNOOZE_MS = 14 * MS_IN_DAY;

const StoredSnooze = z.object({ snoozedAt: z.number() });

/** Время «Не сейчас» из значения хранилища; нет или испорчено — `undefined` (отложки нет). */
export function parseNameHintSnooze(value: unknown): number | undefined {
  const parsed = StoredSnooze.safeParse(value);
  return parsed.success ? parsed.data.snoozedAt : undefined;
}

/**
 * Подсказка на Главной видна: «Не сейчас» не нажимали или нажимали 14 дней назад и раньше. `undefined` — хранилище ещё
 * читается: не показываем (без мигания).
 */
export function nameHintVisible(snoozedAt: number | null | undefined, now: number): boolean {
  if (snoozedAt === undefined) return false;
  return snoozedAt === null || now - snoozedAt >= NAME_HINT_SNOOZE_MS;
}
