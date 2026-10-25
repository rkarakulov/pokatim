import { z } from 'zod';

/**
 * Метки из payload access JWT — без проверки подписи (её делает сервер, `AuthGuard`): чей это access (`sub`, `sid`)
 * и срок жизни по часам сервера (`iat`, `exp`). Для решений «та же ли это сессия» и «пора ли обновлять», не для
 * доступа. Не JWT или нет полей — `undefined` (тогда сессия считается чужой — отказ, а не доверие).
 */
const AccessClaimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  iat: z.number().optional(),
  exp: z.number().optional(),
});
export type AccessClaims = z.infer<typeof AccessClaimsSchema>;

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
}

export function accessClaims(accessToken: string | undefined): AccessClaims | undefined {
  const payload = accessToken?.split('.')[1];
  if (!payload) return undefined;
  try {
    const parsed = AccessClaimsSchema.safeParse(decodeSegment(payload));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Владелец сессии (`sub` access); нет сессии или метки — `undefined`. */
export const sessionOwner = (session: { accessToken: string } | null | undefined) =>
  accessClaims(session?.accessToken)?.sub;

/** Та же сессия (`sub` и `sid` совпадают, ротация refresh их не меняет); без меток — нет. */
export function isSameSession(
  a: { accessToken: string } | null | undefined,
  b: { accessToken: string } | null | undefined,
): boolean {
  const x = accessClaims(a?.accessToken);
  const y = accessClaims(b?.accessToken);
  return x !== undefined && y !== undefined && x.sub === y.sub && x.sid === y.sid;
}
