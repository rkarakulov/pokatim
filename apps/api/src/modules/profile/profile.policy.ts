import { DEFAULT_APP_THEME_ID, type ProfileView } from '@pokatim/contracts';

import type { ProfileDoc } from './profile.collection';

/**
 * Правила записи профиля (profile-rider-name, RC-1): лимит частоты `PATCH /v1/profile` (`RateLimiter` базы, ключ
 * `profile-update:<uid>`). Опрос и шаг устройств онбординга лимита не имеют.
 */
export const PROFILE_POLICY = {
  updateLimit: { limit: 30, windowSec: 3600 },
  /**
   * user-theme: `PUT /v1/profile/theme`, ключ `profile-theme:<uid>` — свой бюджет (RC-3): выбор темы применяется на
   * каждое нажатие и не съедает лимит правки имени.
   */
  themeUpdateLimit: { limit: 60, windowSec: 3600 },
  /** race-results-07: `PUT /v1/profile/verified`, ключ `profile-verified-update:<uid>` */
  verifiedUpdateLimit: { limit: 30, windowSec: 3600 },
  /** rider-profile: `PUT /v1/profile/avatar`, ключ `profile-avatar:<uid>` */
  avatarUploadLimit: { limit: 20, windowSec: 3600 },
  /**
   * rider-profile: одновременных **чтений тела** аватара — на процесс API и на пользователя (ревью PR A, MEDIUM-B):
   * чтение держит ≤ 10 МиБ буфера, память libvips — отдельное место обработки (`avatarProcessing`).
   */
  avatarSlots: { maxTotal: 4, maxPerUser: 1 },
  /**
   * rider-profile: обработка sharp — одна на процесс (пик памяти — ADR-0019, лимит контейнера API 512 МБ); занято —
   * ожидание до 5 с, затем `429`.
   */
  avatarProcessing: { concurrency: 1, waitMs: 5_000 },
  /**
   * rider-profile: таймауты тела аватара (MEDIUM-2 ревью) — короче общих (`DEFAULT_BODY_TIMEOUTS` 30/180 с): 10 МиБ на
   * 2 Мбит/с ≈ 42 с; медленная отправка не держит единственный слот процесса дольше минуты.
   */
  avatarBodyTimeouts: { idleMs: 10_000, totalMs: 60_000 },
  /** profile-moderation: `POST /v1/riders/:publicId/reports`, ключ `profile-report:<uid>` — 20 жалоб в сутки */
  reportLimit: { limit: 20, windowSec: 86_400 },
} as const;

/**
 * Публичен ли профиль (rider-profile, profile-moderation): имя строкой и согласие на показ. Та же проверка, что в
 * фильтре `findPublic` и `findPublicNames`; переход «публичен → нет» перевыпускает id фото (RC-A2 (b)).
 */
export function isPublicProfile(
  doc: Pick<ProfileDoc, 'publicName' | 'showNameInResults'> | null | undefined,
): boolean {
  return typeof doc?.publicName === 'string' && doc.showNameInResults === true;
}

/**
 * Ответ `ProfileView` из документа (нет документа — пустой профиль): поля до слайсов могут отсутствовать. `publicId`
 * наружу — только при имени и согласии (R-3: сам id хранится и после отзыва). Темы нет — «Классика» (user-theme).
 */
export function profileViewOf(
  doc: Pick<
    ProfileDoc,
    | 'rideReasons'
    | 'publicName'
    | 'showNameInResults'
    | 'club'
    | 'avatarId'
    | 'publicId'
    | 'themeId'
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
    themeId: doc?.themeId ?? DEFAULT_APP_THEME_ID,
  };
}
