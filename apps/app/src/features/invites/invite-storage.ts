import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

import { INVITE_KEY, inviteToRemember, isInviteFresh, parseStoredInvite } from './invite-state';

/**
 * Код приглашения на устройстве (P6, K9): native — `secureStorage` (другой KV-зависимости нет, как отложка push),
 * web — `invite-storage.web.ts` (`localStorage`). Последний код перекрывает прежний; старше 7 дней — стирается. Сбой
 * хранилища — не падение: регистрация пройдёт без кода.
 */
export async function rememberInvite(raw: unknown, now: number): Promise<void> {
  const invite = inviteToRemember(raw, now);
  if (!invite) return;
  try {
    await secureStorage.set(INVITE_KEY, JSON.stringify(invite));
  } catch (error) {
    console.warn(`invite not persisted: ${(error as Error).name}`);
  }
}

/** Действующий код для регистрации; просроченный — стирается, `null`. */
export async function takeInvite(now = Date.now()): Promise<string | null> {
  const invite = await readJson(INVITE_KEY, parseStoredInvite);
  if (!invite) return null;
  if (isInviteFresh(invite, now)) return invite.code;
  await forgetInvite();
  return null;
}

export async function forgetInvite(): Promise<void> {
  await secureStorage.delete(INVITE_KEY).catch(() => undefined);
}
