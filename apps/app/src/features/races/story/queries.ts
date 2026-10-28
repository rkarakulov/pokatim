import type { StoryCardTemplate } from '@pokatim/contracts';

import type { CardSource } from '@/features/sharing/card-status';
import { api } from '@/lib/api';

/** Карточка для сторис своего результата (story-cards): ключ шаблона и статус — общий поток `features/sharing`. */
export const storyCardKey = (raceId: string, template: StoryCardTemplate) =>
  ['races', 'story', raceId, template] as const;

export const raceStorySource = (raceId: string): CardSource => ({
  key: (template) => storyCardKey(raceId, template),
  fetch: (token, template) => api.getStoryCard(token, raceId, { template }),
});
