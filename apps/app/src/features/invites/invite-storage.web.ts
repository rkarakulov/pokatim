import { INVITE_KEY, inviteToRemember, isInviteFresh, parseStoredInvite } from './invite-state';

/**
 * Web: код приглашения — в `localStorage` (переживает закрытие вкладки до регистрации, P6). SSR, приватный режим,
 * запрет хранилища — без кода, не падаем.
 */
const storage = (): Storage | undefined => {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
};

export async function rememberInvite(raw: unknown, now: number): Promise<void> {
  const invite = inviteToRemember(raw, now);
  if (!invite) return;
  try {
    storage()?.setItem(INVITE_KEY, JSON.stringify(invite));
  } catch (error) {
    console.warn(`localStorage unavailable: ${(error as Error).name}`);
  }
}

export async function takeInvite(now = Date.now()): Promise<string | null> {
  let invite;
  try {
    const raw = storage()?.getItem(INVITE_KEY);
    invite = raw ? parseStoredInvite(JSON.parse(raw)) : undefined;
  } catch {
    invite = undefined;
  }
  if (invite && isInviteFresh(invite, now)) return invite.code;
  await forgetInvite();
  return null;
}

export async function forgetInvite(): Promise<void> {
  try {
    storage()?.removeItem(INVITE_KEY);
  } catch {
    // хранилище недоступно — стирать нечего
  }
}
