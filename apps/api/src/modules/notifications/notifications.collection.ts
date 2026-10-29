import type {
  NotificationGroup,
  NotificationKind,
  NotificationSettings,
  NotificationTarget,
  PushPlatform,
} from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции центра уведомлений (ADR-0017). Создаёт миграция `0025_notifications`; единственный писатель — модуль
 * `notifications`. TTL-индексы — только уборка: истечение проверяет сервер по `CLOCK`.
 */
export const NOTIFICATIONS_COLLECTIONS = {
  notifications: 'notifications',
  settings: 'notification_settings',
  pushTokens: 'push_tokens',
  pushTickets: 'push_tickets',
} as const;

export type PushDeliveryState = 'pending' | 'sending' | 'sent' | 'skipped' | 'limited' | 'failed';
export type EmailDeliveryState = 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';

/** Состояние push уведомления: захват (`claimId`, `claimedUntil`) — как у писем identity; `notBefore` — тихие часы. */
export interface PushDelivery {
  state: PushDeliveryState;
  notBefore: Date;
  claimId: string | null;
  claimedUntil: Date | null;
  sentAt: Date | null;
  reason: string | null;
  /** лимит 20/ч уже списан попыткой, упавшей на отправке: ретрай не списывает его снова */
  limitCharged?: boolean;
}

/** Письмо — только событиям N2 (`ride_cancelled`, `dispute_decided`), иначе `null`. */
export interface EmailDelivery {
  state: EmailDeliveryState;
  claimedUntil: Date | null;
  sentAt: Date | null;
}

/**
 * Уведомление: текст — снимок на момент создания (без чужих ПДн, N12), цель — тип + id из белого списка. Одно на
 * `(sourceEventId, userId)`; повтор по объекту схлопывается по `collapseKey` (N7). `expireAt = createdAt + 90 дней`.
 */
export interface NotificationDoc {
  _id: string;
  userId: string;
  kind: NotificationKind;
  group: NotificationGroup;
  title: string;
  body: string;
  target: NotificationTarget | null;
  sourceEventId: string;
  collapseKey?: string;
  /** порядковый номер записанного события в объекте (с `collapseKey`); документы до него поля не имеют */
  collapseSeq?: number;
  createdAt: Date;
  readAt: Date | null;
  expireAt: Date;
  push: PushDelivery;
  email: EmailDelivery | null;
}

/** Настройки пользователя: `_id = userId`; нет документа — `DEFAULT_NOTIFICATION_SETTINGS`. */
export interface NotificationSettingsDoc extends NotificationSettings {
  _id: string;
  updatedAt: Date;
}

/**
 * Push-токен устройства: Expo (`ios`/`android`) или подписка Web Push (`web`, ADR-0022: `token` — endpoint
 * push-сервиса, ключи шифрования — `webPush`). Уникален глобально (устройство одно — владелец переходит), ≤ 10 на
 * пользователя.
 * `sessionId` — сессия, под которой токен зарегистрирован: push уходит, только пока она жива (выход, сброс пароля,
 * отзыв, reuse detection — токен снимается при доставке). Токены, записанные до привязки, без поля — как мёртвые.
 */
export interface PushTokenDoc {
  _id: string;
  token: string;
  userId: string;
  sessionId?: string;
  platform: PushTokenPlatform;
  /** Ключи подписки Web Push (`PushSubscription.keys`) — только у `web`. */
  webPush?: { p256dh: string; auth: string };
  createdAt: Date;
  updatedAt: Date;
}

/** Платформа токена: Expo (`PUSH_PLATFORMS` контракта) или Web Push. */
export type PushTokenPlatform = PushPlatform | 'web';

/**
 * Тикет Expo Push до проверки квитанции (≥ 15 мин); `expireAt = createdAt + 24 ч`. `userId` — владелец токена на момент
 * отправки: стирание аккаунта находит тикеты и после снятия токенов (`push_tickets_user_idx`, 0027).
 */
export interface PushTicketDoc {
  _id: string;
  ticketId: string;
  tokenId: string;
  userId: string;
  createdAt: Date;
  expireAt: Date;
}

export function notificationsCollections(db: Db): {
  notifications: Collection<NotificationDoc>;
  settings: Collection<NotificationSettingsDoc>;
  pushTokens: Collection<PushTokenDoc>;
  pushTickets: Collection<PushTicketDoc>;
} {
  return {
    notifications: db.collection<NotificationDoc>(NOTIFICATIONS_COLLECTIONS.notifications),
    settings: db.collection<NotificationSettingsDoc>(NOTIFICATIONS_COLLECTIONS.settings),
    pushTokens: db.collection<PushTokenDoc>(NOTIFICATIONS_COLLECTIONS.pushTokens),
    pushTickets: db.collection<PushTicketDoc>(NOTIFICATIONS_COLLECTIONS.pushTickets),
  };
}
