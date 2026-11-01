import type { ReactionDoc } from './social.collection';

/**
 * Порт «Свои» для модуля `notifications` (K10, P7, ADR-0027 п. 6; через `modules/social/index.ts`): состояние «сейчас»
 * для приёма событий `social.*` и аудитория «Свои идут». `notifications` коллекций `social` не читает.
 */
export const SOCIAL_NOTICES = Symbol('SOCIAL_NOTICES');

/** Реакция для уведомления: вид, лицо, получатель и цель — без времени и id документа. */
export type SocialReactionNotice = Pick<
  ReactionDoc,
  'kind' | 'actorId' | 'recipientId' | 'targetType' | 'targetId'
>;

export interface SocialNotices {
  /** Реакция сейчас; снята или стёрта — `null`. */
  reaction(reactionId: string): Promise<SocialReactionNotice | null>;
  /**
   * «Свои идут» (RC-P7-1a, RC-P7-3): владельцы не убранных связей к `riderId`, к которым `riderId` тоже держит не
   * убранную связь (взаимная, как «Идёт» K6).
   */
  goingAudience(riderId: string): Promise<string[]>;
  /** Связь `ownerId → otherId` есть и не убрана. */
  connected(ownerId: string, otherId: string): Promise<boolean>;
}
