import type { AchievementCode, StoryCardTemplate } from '@pokatim/contracts';

import type { CardSource } from '@/features/sharing/card-status';
import { api } from '@/lib/api';

/** Экран своего достижения (`/achievements/<code>`). */
export const achievementPath = (code: string) => `/achievements/${code}`;

/** Экран карточки достижения для сторис (внутри `Stack.Protected`). */
export const achievementStoryPath = (code: string) => `/achievements/story/${code}`;

export const achievementStoryKey = (code: AchievementCode, template: StoryCardTemplate) =>
  ['achievements', 'story', code, template] as const;

/** Статус карточки своего достижения — общий поток `features/sharing` (ADR-0018). */
export const achievementStorySource = (code: AchievementCode): CardSource => ({
  key: (template) => achievementStoryKey(code, template),
  fetch: (token, template) => api.getAchievementCard(token, code, { template }),
});
