import { type CreateRideRequest, RideView } from '@pokatim/contracts';

import { ridesCollections } from '../src/modules/rides/rides.collection';
import { DAY, type Harness } from './harness';
import { bearer, call, type CallResult, signUpSession, userIdByEmail } from './identity';

export const RIDES = '/v1/rides';

/** Коллекция `rides` тестовой БД. */
export const ridesDb = (h: Harness) => ridesCollections(h.db).rides;

/** Вошедший райдер стенда: access и id пользователя. */
export interface Rider {
  token: string;
  userId: string;
}

export async function rider(h: Harness, email: string): Promise<Rider> {
  const session = await signUpSession(h, email);
  return { token: session.accessToken, userId: await userIdByEmail(h, email) };
}

/** Момент через `offsetMs` от «сейчас» стенда, с точностью до минуты (`UtcMinute`). */
export function startsIn(h: Harness, offsetMs: number): string {
  const at = new Date(h.clock.now().getTime() + offsetMs);
  at.setUTCSeconds(0, 0);
  return at.toISOString().replace('.000Z', 'Z');
}

export const rideBody = (
  h: Harness,
  overrides: Partial<CreateRideRequest> = {},
): CreateRideRequest => ({
  title: 'Кофе-райд на море',
  organizerName: null,
  startsAt: startsIn(h, DAY),
  cityCode: 'minsk',
  place: 'Парк Победы, у входа',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  description: 'Едем спокойно',
  ...overrides,
});

export const authed = (
  h: Harness,
  who: Rider,
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
): Promise<CallResult> => call(h, method, url, payload, bearer(who.token));

/** Создать райд и вернуть его карточку организатора (с `version`). */
export async function createRide(
  h: Harness,
  organizer: Rider,
  overrides: Partial<CreateRideRequest> = {},
): Promise<RideView['ride'] & { version: number }> {
  const res = await authed(h, organizer, 'POST', RIDES, rideBody(h, overrides));
  if (res.status !== 201) throw new Error(`райд: ${res.status} ${JSON.stringify(res.body)}`);
  const view = RideView.parse(res.body);
  if (!('version' in view.ride)) throw new Error('нет version у организатора');
  return view.ride;
}

export const join = (h: Harness, who: Rider, id: string) =>
  authed(h, who, 'POST', `${RIDES}/${id}/join`, {});
export const leave = (h: Harness, who: Rider, id: string) =>
  authed(h, who, 'POST', `${RIDES}/${id}/leave`, {});

/** Коды полей `VALIDATION_FAILED`. */
export const fieldCodesOf = (body: unknown) =>
  (body as { details?: { fields?: { path: string; code: string }[] } }).details?.fields ?? [];

// --- жалобы и модерация (05b) ---

/** Пожаловаться на райд. */
export const report = (
  h: Harness,
  who: Rider,
  id: string,
  body: Record<string, unknown> = { reason: 'spam' },
) => authed(h, who, 'POST', `${RIDES}/${id}/reports`, body);

/**
 * Скрыть райд напрямую в БД (подготовка теста видимости, не проверяемое действие — его проверяет
 * `rides-moderation.int.test.ts`). Возвращает функцию «вернуть как было».
 */
export async function hideInDb(h: Harness, id: string): Promise<() => Promise<void>> {
  const doc = await ridesDb(h).findOne({ _id: id });
  if (!doc || doc.status === 'hidden') throw new Error('райд не найден или уже скрыт');
  const from = doc.status;
  await ridesDb(h).updateOne(
    { _id: id },
    {
      $set: { status: 'hidden', hiddenFromStatus: from, hiddenAt: h.clock.now() },
      $inc: { version: 1 },
    },
  );
  return async () => {
    await ridesDb(h).updateOne(
      { _id: id },
      { $set: { status: from, hiddenFromStatus: null, hiddenAt: null }, $inc: { version: 1 } },
    );
  };
}

export const MODERATION = '/v1/admin/rides';
