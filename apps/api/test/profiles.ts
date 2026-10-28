import { randomBytes } from 'node:crypto';

import { ProfileView } from '@pokatim/contracts';
import { Binary } from 'mongodb';

import { profileReportsCollections } from '../src/modules/profile/profile-reports.collection';
import {
  PROFILE_COLLECTIONS,
  type ProfileAvatarDoc,
  type ProfileDoc,
} from '../src/modules/profile/profile.collection';
import type { Harness } from './harness';
import { bearer, call, type CallResult } from './identity';
import { panelCall } from './panel';
import { rider, type Rider } from './rides';

/** Стенд модерации профилей (profile-moderation): коллекции, публичный райдер, фото без sharp, вызовы. */
export const profilesDb = (h: Harness) => h.db.collection<ProfileDoc>(PROFILE_COLLECTIONS.profiles);
export const avatarsDb = (h: Harness) =>
  h.db.collection<ProfileAvatarDoc>(PROFILE_COLLECTIONS.avatars);
export const profileReportsDb = (h: Harness) => profileReportsCollections(h.db).reports;

export interface PublicRider extends Rider {
  publicId: string;
}

/** `PATCH /v1/profile` (тест знает, что успешно) — профиль после записи. */
export async function patchProfile(
  h: Harness,
  who: Rider,
  body: Record<string, unknown>,
): Promise<ProfileView> {
  const res = await call(h, 'PATCH', '/v1/profile', body, bearer(who.token));
  if (res.status !== 200) throw new Error(`PATCH /v1/profile: ${res.status}`);
  return ProfileView.parse(res.body);
}

/** Райдер с публичным профилем (имя + согласие) и клубом. */
export async function publicRider(
  h: Harness,
  email: string,
  publicName = 'Анна К.',
  club: string | null = 'Velo Minsk',
): Promise<PublicRider> {
  const who = await rider(h, email);
  const view = await patchProfile(h, who, { publicName, showNameInResults: true, club });
  if (!view.publicId) throw new Error('нет publicId');
  return { ...who, publicId: view.publicId };
}

/** Фото райдера напрямую в БД (без sharp): документ `profile_avatars` и `profiles.avatarId`; байты и id. */
export async function seedAvatar(
  h: Harness,
  userId: string,
): Promise<{ id: string; bytes: Buffer }> {
  const id = randomBytes(32).toString('base64url');
  const bytes = randomBytes(64);
  await avatarsDb(h).insertOne({
    _id: id,
    userId,
    bytes: new Binary(bytes),
    contentType: 'image/jpeg',
    width: 512,
    height: 512,
    bytesLength: bytes.length,
    createdAt: h.clock.now(),
  });
  await profilesDb(h).updateOne({ _id: userId }, { $set: { avatarId: id } });
  return { id, bytes };
}

/** `GET /v1/avatars/:id` — статус и байты. */
export async function fetchAvatar(
  h: Harness,
  id: string,
): Promise<{ status: number; raw: Buffer }> {
  const response = await h.app.inject({ method: 'GET', url: `/v1/avatars/${id}` });
  return { status: response.statusCode, raw: response.rawPayload };
}

/** Зритель и жалоба приложения (`AuthGuard`). */
export const riderViewer = (h: Harness, token: string | undefined, publicId: string) =>
  call(h, 'GET', `/v1/riders/${publicId}/me`, undefined, token ? bearer(token) : {});
export const reportRider = (
  h: Harness,
  token: string | undefined,
  publicId: string,
  body: unknown = { reason: 'photo' },
): Promise<CallResult> =>
  call(h, 'POST', `/v1/riders/${publicId}/reports`, body, token ? bearer(token) : {});

/** Модерация профилей панели. */
export const RIDER_PROFILES = '/v1/admin/rider-profiles';
export const profileModerationCall = (
  h: Harness,
  token: string | undefined,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) => panelCall(h, token, method, `${RIDER_PROFILES}${path}`, body);
