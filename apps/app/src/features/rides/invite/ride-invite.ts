import type { StoryCardTemplate } from '@pokatim/contracts';

import type { CardSource } from '@/features/sharing/card-status';
import { api } from '@/lib/api';

export const ridePath = (id: string) => `/rides/${id}`;

/** Экран карточки-приглашения кофе-райда (внутри `Stack.Protected`). */
export const rideInvitePath = (id: string) => `/rides/invite/${id}`;

export const rideInviteKey = (rideId: string, template: StoryCardTemplate) =>
  ['rides', 'invite', rideId, template] as const;

/** Статус карточки-приглашения — общий поток `features/sharing` (ADR-0018). */
export const rideInviteSource = (rideId: string): CardSource => ({
  key: (template) => rideInviteKey(rideId, template),
  fetch: (token, template) => api.getRideInviteCard(token, rideId, { template }),
});
