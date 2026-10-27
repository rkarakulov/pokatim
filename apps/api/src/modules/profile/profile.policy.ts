/**
 * Правила записи профиля (profile-rider-name, RC-1): лимит частоты `PATCH /v1/profile` (`RateLimiter` базы, ключ
 * `profile-update:<uid>`). Опрос и шаг устройств онбординга лимита не имеют.
 */
export const PROFILE_POLICY = {
  updateLimit: { limit: 30, windowSec: 3600 },
  /** race-results-07: `PUT /v1/profile/verified`, ключ `profile-verified-update:<uid>` */
  verifiedUpdateLimit: { limit: 30, windowSec: 3600 },
} as const;
