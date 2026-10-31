import type { AchievementCode, StoryCardTemplate } from '@pokatim/contracts';

import type { CardSource } from '@/features/sharing/card-status';
import { api } from '@/lib/api';

/**
 * Экран карточки достижения для сторис (внутри `Stack.Protected`): `/achievements/story/<code>`, у сезонных —
 * `?season=<id>` (C2).
 */
export const achievementStoryPath = (code: string, seasonId: string | null) =>
  seasonId === null
    ? `/achievements/story/${code}`
    : `/achievements/story/${code}?season=${encodeURIComponent(seasonId)}`;

/** Ключ статуса: сезон в ключе — иначе карточки двух сезонов делят кэш. */
export const achievementStoryKey = (
  code: AchievementCode,
  seasonId: string | null,
  template: StoryCardTemplate,
) => ['achievements', 'story', code, seasonId, template] as const;

/** Статус карточки своего достижения — общий поток `features/sharing` (ADR-0018); `seasonId` — только у сезонных. */
export const achievementStorySource = (
  code: AchievementCode,
  seasonId: string | null,
): CardSource => ({
  key: (template) => achievementStoryKey(code, seasonId, template),
  fetch: (token, template) =>
    api.getAchievementCard(token, code, seasonId ? { template, seasonId } : { template }),
});
