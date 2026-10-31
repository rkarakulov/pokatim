export { SocialCoreModule, SocialModule, SocialWorkerModule } from './social.module';
/** Порт стирания «Свои» удалённого аккаунта (модуль `account`). */
export { SocialErasure, type SocialErasureResult } from './social-erasure';
/** Порт кодов приглашений (P6): адрес `/i/<code>` на карточках `sharing` (RC-P6-4). */
export { InviteCodes } from './invite-codes.service';
/** Маршруты outbox подписчика «Свои» (`subscriberOutboxRoutes`). */
export { socialOutboxRoutes } from './social.events';
