import type { ProfileView } from '@pokatim/contracts';
import { z } from 'zod';

import { MS_IN_DAY } from '@/features/pwa-install/install-prompt-state';

/** Ключ паузы шита «Как вас показывать в результатах?» на устройстве (native — SecureStore, web — `localStorage`). */
export const NAME_CONSENT_PROMPT_KEY = 'pokatim.nameConsentPrompt';

/** Пауза после «Не сейчас», закрытия или сохранения без показа (name-consent-prompt, N3). */
export const NAME_CONSENT_SNOOZE_MS = 90 * MS_IN_DAY;

const StoredSnooze = z.object({ snoozedAt: z.number() });

/** Время паузы из значения хранилища; нет или испорчено — `undefined` (паузы нет). */
export function parseNameConsentSnooze(value: unknown): number | undefined {
  const parsed = StoredSnooze.safeParse(value);
  return parsed.success ? parsed.data.snoozedAt : undefined;
}

/** Имя уже видно в таблицах: и имя, и согласие (P1). */
export const showsPublicName = (profile: ProfileView): boolean =>
  profile.publicName !== null && profile.showNameInResults;

export interface NameConsentInput {
  /** профиль из кэша `['profile']`; `undefined` — ещё не пришёл или ошибка */
  profile: ProfileView | undefined;
  /** время паузы: `null` — не откладывали, `undefined` — хранилище ещё читается */
  snoozedAt: number | null | undefined;
  now: number;
}

/**
 * Показать шит (N2): профиль известен, имя ещё не показывается, пауза не действует. Что-то неизвестно — нет: без
 * мигания и без шита при ошибке профиля.
 */
export function nameConsentVisible({ profile, snoozedAt, now }: NameConsentInput): boolean {
  if (profile === undefined || snoozedAt === undefined) return false;
  if (showsPublicName(profile)) return false;
  return snoozedAt === null || now - snoozedAt >= NAME_CONSENT_SNOOZE_MS;
}
