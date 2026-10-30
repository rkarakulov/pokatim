import type { StoryCardTemplate } from '@pokatim/contracts';

import type { CardSource } from '@/features/sharing/card-status';
import { api } from '@/lib/api';

/** Экран карточки маршрута каталога для сторис (внутри `Stack.Protected`). */
export const routeStoryPath = (id: string) => `/routes/story/${encodeURIComponent(id)}`;

export const routeStoryKey = (routeId: string, template: StoryCardTemplate) =>
  ['routes', 'story', routeId, template] as const;

/** Статус карточки маршрута — общий поток `features/sharing` (ADR-0018). */
export const routeStorySource = (routeId: string): CardSource => ({
  key: (template) => routeStoryKey(routeId, template),
  fetch: (token, template) => api.getRouteStoryCard(token, routeId, { template }),
});
