import { InviteCode } from '@pokatim/contracts';

/** Ключ хранилища сохранённого кода приглашения (native — `secureStorage`, web — `localStorage`). */
export const INVITE_KEY = 'pokatim.invite';

/** Срок хранения кода на клиенте (K9 `[ASSUMPTION]`): старше — не используется и стирается. */
export const INVITE_TTL_MS = 7 * 24 * 3600_000;

/** Последний код приглашения и время перехода по ссылке (мс). */
export interface StoredInvite {
  code: string;
  at: number;
}

/** Запись хранилища по формату; чужое и битое — `undefined`. */
export function parseStoredInvite(value: unknown): StoredInvite | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { code, at } = value as Record<string, unknown>;
  const parsed = InviteCode.safeParse(code);
  if (!parsed.success || typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  return { code: parsed.data, at };
}

/** Код из ссылки (`?invite=`, `/i/<код>`) для записи; не по формату — `null` (последний валидный не перекрывается). */
export function inviteToRemember(raw: unknown, now: number): StoredInvite | null {
  const parsed = InviteCode.safeParse(raw);
  return parsed.success ? { code: parsed.data, at: now } : null;
}

/** Действует ли сохранённый код: не старше 7 дней. */
export const isInviteFresh = (invite: StoredInvite, now: number) =>
  now - invite.at <= INVITE_TTL_MS;
