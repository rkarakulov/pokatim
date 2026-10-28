/**
 * Карточка для сторис (story-cards, ADR-0018): Redis-ключи с TTL, лимиты, задача рендера. **Изменил разметку, тексты
 * или токены карточки (`storyCard` в `@pokatim/design-tokens`, строки `storyCard.*`) — подними `renderVersion`**:
 * иначе до 24 ч отдаётся старая картинка (ключ кэша — хэш входов с версией).
 */
export const STORY_CARD_POLICY = {
  renderVersion: 1,
  /** PNG и ключ хэш → токен, с */
  pngTtlSec: 86_400,
  /** ключ постановки рендера (NX), с */
  pendingTtlSec: 120,
  /** отметка провала рендера (читается `GETDEL` — сообщается один раз), с */
  failedTtlSec: 600,
  maxPngBytes: 2_000_000,
  /** чтение статуса на пользователя (опрос 1/с × 30 с × 2 шаблона) */
  readLimit: { limit: 120, windowSec: 60 },
  /** постановок рендера на пользователя — списывается только при захвате ключа постановки */
  renderLimit: { limit: 30, windowSec: 3600 },
  /** выдача PNG по IP */
  imageIpLimit: { limit: 120, windowSec: 60 },
  jobAttempts: 2,
  jobBackoffMs: 2_000,
} as const;
