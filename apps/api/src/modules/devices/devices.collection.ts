import type { DeviceIssue, DeviceProvider } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `devices` (ADR-0011): пользователи и подключения в агрегаторе, тикеты активации, импорт
 * тренировок, журнал. Создаёт миграция `0011_devices`; единственный писатель — `DevicesRepository`. Токенов
 * провайдеров нет — их держит агрегатор (R13); ключи агрегатора — только env.
 */
export const DEVICES_COLLECTIONS = {
  accounts: 'device_accounts',
  connections: 'device_connections',
  tickets: 'device_link_tickets',
  imports: 'device_imports',
  audit: 'device_audit',
} as const;

export type DeviceAggregator = 'open_wearables';

/** Пользователь агрегатора для пользователя pokatim (`_id` = userId), создаётся лениво в `connect`. */
export interface DeviceAccountDoc {
  _id: string;
  aggregator: DeviceAggregator;
  aggUserId: string;
  createdAt: Date;
}

export type DeviceConnectionStatus = 'pending' | 'active' | 'disconnecting' | 'revoked';
/** Живые статусы: один документ на `(userId, provider)` (частичный уникальный индекс). */
export const LIVE_CONNECTION_STATUSES: readonly DeviceConnectionStatus[] = [
  'pending',
  'active',
  'disconnecting',
];

export interface DeviceConnectionDoc {
  _id: string;
  userId: string;
  aggUserId: string;
  provider: DeviceProvider;
  status: DeviceConnectionStatus;
  issue: DeviceIssue | null;
  /** До какого момента `pending` ждёт `complete` (TTL тикета); затем уборка отзывает подключение в агрегаторе. */
  pendingUntil: Date | null;
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  /** До этого момента pull берёт полное окно истории (историческая выгрузка приходит асинхронно). */
  catchUpUntil: Date | null;
  failedImports: number;
  revokedAt: Date | null;
  revokedReason: 'user' | 'unconfirmed' | 'foreign_ticket' | 'aggregator' | null;
  revokeFailed: boolean;
  version: number;
}

/** Одноразовый тикет активации (`_id` = sha256 тикета), TTL-индекс по `expiresAt`. */
export interface DeviceLinkTicketDoc {
  _id: string;
  userId: string;
  provider: DeviceProvider;
  connectionId: string;
  returnUrl: string;
  expiresAt: Date;
}

/** Импорт тренировки агрегатора: уникален `(provider, aggWorkoutId)`; `deleted` — надгробие удалённой загрузки. */
export interface DeviceImportDoc {
  _id: string;
  userId: string;
  provider: DeviceProvider;
  aggWorkoutId: string;
  status: 'queued' | 'imported' | 'skipped' | 'failed' | 'deleted';
  reason: string | null;
  attempts: number;
  uploadId: string | null;
  firstSeenAt: Date;
  updatedAt: Date;
}

/** Журнал подключений — append-only (только `insertOne`), без идентификаторов агрегатора. */
export interface DeviceAuditDoc {
  _id: string;
  userId: string;
  provider: DeviceProvider;
  connectionId: string;
  action: 'connected' | 'disconnected' | 'revoke_failed' | 'reauthorize_required';
  reason: string | null;
  at: Date;
}

export interface DevicesCollections {
  accounts: Collection<DeviceAccountDoc>;
  connections: Collection<DeviceConnectionDoc>;
  tickets: Collection<DeviceLinkTicketDoc>;
  imports: Collection<DeviceImportDoc>;
  audit: Collection<DeviceAuditDoc>;
}

export function devicesCollections(db: Db): DevicesCollections {
  return {
    accounts: db.collection<DeviceAccountDoc>(DEVICES_COLLECTIONS.accounts),
    connections: db.collection<DeviceConnectionDoc>(DEVICES_COLLECTIONS.connections),
    tickets: db.collection<DeviceLinkTicketDoc>(DEVICES_COLLECTIONS.tickets),
    imports: db.collection<DeviceImportDoc>(DEVICES_COLLECTIONS.imports),
    audit: db.collection<DeviceAuditDoc>(DEVICES_COLLECTIONS.audit),
  };
}
