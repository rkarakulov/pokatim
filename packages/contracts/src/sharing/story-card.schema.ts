import { z } from 'zod';

import { fieldError } from '../common.ts';

/**
 * Карточка для сторис (story-cards, ADR-0018). Шаблоны — только в конец: `line` — светлая схема темы,
 * «карточка-линия»; `night` — тёмная схема, мастхед.
 */
export const STORY_CARD_TEMPLATES = ['line', 'night'] as const;
export const StoryCardTemplate = z.enum(STORY_CARD_TEMPLATES, { error: fieldError('INVALID') });
export type StoryCardTemplate = z.infer<typeof StoryCardTemplate>;

/** `GET /v1/races/:raceId/entry/story-card` — query; лишние ключи и незнакомый шаблон — 400. */
export const StoryCardQuery = z.strictObject({ template: StoryCardTemplate });
export type StoryCardQuery = z.infer<typeof StoryCardQuery>;

/** Капабилити-токен картинки: 128 бит, base64url без `=`. */
export const StoryCardToken = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/**
 * Статус карточки: рендер в очереди / готово (токен → `storyCardImageUrl` api-client) / последний рендер не удался
 * (сообщается один раз; повтор запроса ставит рендер заново). Незнакомый статус будущего сервера — ошибка разбора.
 */
export const StoryCardStatus = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('ready'), token: StoryCardToken }),
  z.object({ status: z.literal('failed') }),
]);
export type StoryCardStatus = z.infer<typeof StoryCardStatus>;

/** Размер PNG, px (геометрия — `storyCard` в `@pokatim/design-tokens`). */
export const STORY_CARD_SIZE = { width: 1080, height: 1920 } as const;
