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

/** Push-токен устройства (Expo): уникален глобально (устройство одно — владелец переходит), ≤ 10 на пользователя. */
export interface PushTokenDoc {
  _id: string;
  token: string;
  userId: string;
  platform: PushPlatform;
  createdAt: Date;
  updatedAt: Date;
}

/** Тикет Expo Push до проверки квитанции (≥ 15 мин); `expireAt = createdAt + 24 ч`. */
export interface PushTicketDoc {
  _id: string;
  ticketId: string;
  tokenId: string;
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
