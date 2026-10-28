import type { ProfileView } from '@pokatim/contracts';

import type { ProfileDoc } from './profile.collection';

/**
 * Правила записи профиля (profile-rider-name, RC-1): лимит частоты `PATCH /v1/profile` (`RateLimiter` базы, ключ
 * `profile-update:<uid>`). Опрос и шаг устройств онбординга лимита не имеют.
 */
export const PROFILE_POLICY = {
  updateLimit: { limit: 30, windowSec: 3600 },
  /** race-results-07: `PUT /v1/profile/verified`, ключ `profile-verified-update:<uid>` */
  verifiedUpdateLimit: { limit: 30, windowSec: 3600 },
  /** rider-profile: `PUT /v1/profile/avatar`, ключ `profile-avatar:<uid>` */
  avatarUploadLimit: { limit: 20, windowSec: 3600 },
  /** rider-profile: одновременных приёмов аватара — на процесс API и на пользователя */
  avatarSlots: { maxTotal: 2, maxPerUser: 1 },
} as const;

/**
 * Ответ `ProfileView` из документа (нет документа — пустой профиль): поля до слайсов могут отсутствовать. `publicId`
 * наружу — только при имени и согласии (R-3: сам id хранится и после отзыва).
 */
export function profileViewOf(
  doc: Pick<
    ProfileDoc,
    'rideReasons' | 'publicName' | 'showNameInResults' | 'club' | 'avatarId' | 'publicId'
  > | null,
): ProfileView {
  const publicName = doc?.publicName ?? null;
  const showNameInResults = doc?.showNameInResults ?? false;
  const avatarId = doc?.avatarId ?? null;
  return {
    rideReasons: doc?.rideReasons ?? [],
    publicName,
    showNameInResults,
    club: doc?.club ?? null,
    avatar: avatarId ? { id: avatarId } : null,
    publicId: publicName !== null && showNameInResults ? (doc?.publicId ?? null) : null,
  };
}
