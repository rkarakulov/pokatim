export { SocialCoreModule, SocialModule, SocialWorkerModule } from './social.module';
/** Порт стирания «Свои» удалённого аккаунта (модуль `account`). */
export { SocialErasure, type SocialErasureResult } from './social-erasure';
/** Порт кодов приглашений (P6): адрес `/i/<code>` на карточках `sharing` (RC-P6-4). */
export { InviteCodes } from './invite-codes.service';
/** Маршруты outbox подписчика «Свои» (`subscriberOutboxRoutes`). */
export { socialOutboxRoutes } from './social.events';
/** Для `notifications` (K10, P7): события `social.*` и порт состояния «сейчас». */
export {
  SOCIAL_CONNECTION_ADDED,
  SOCIAL_INVITE_REGISTERED,
  SOCIAL_REACTION_CREATED,
  SOCIAL_RIDE_ASK_DUE,
  SocialConnectionAdded,
  SocialInviteRegistered,
  SocialReactionCreated,
  SocialRideAskDue,
} from './social.events';
export {
  SOCIAL_NOTICES,
  type SocialNotices,
  type SocialReactionNotice,
} from './social-notices.port';
