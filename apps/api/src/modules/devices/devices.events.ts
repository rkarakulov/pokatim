import { z } from 'zod';

import { QUEUE } from '../../queues';
import { TRACK_UPLOAD_DELETED } from '../tracks';

/** Подключение подтверждено владельцем тикета — историческая выгрузка и первый pull. В payload — только id. */
export const DEVICES_CONNECTED = 'devices.connected';
export const DevicesConnected = z.object({ connectionId: z.uuid() });
export type DevicesConnected = z.infer<typeof DevicesConnected>;

/**
 * Нужно отозвать подключение в агрегаторе (отключение пользователем, чужой тикет, неподтверждённое за TTL тикета):
 * worker → `revokeConnection` → `revoked`; `deleteActivities` — удалить загрузки провайдера пользователя.
 */
export const DEVICES_REVOKE_REQUESTED = 'devices.revoke-requested';
export const DevicesRevokeRequested = z.object({
  connectionId: z.uuid(),
  reason: z.enum(['user', 'foreign_ticket', 'unconfirmed']),
  deleteActivities: z.boolean(),
});
export type DevicesRevokeRequested = z.infer<typeof DevicesRevokeRequested>;

/** Задача pull подключения (ставится напрямую, не через outbox): дедупликация — `ow-pull:<connectionId>`. */
export const DEVICES_PULL_JOB = 'pull';
export const DevicesPullJob = z.object({ connectionId: z.uuid() });
export type DevicesPullJob = z.infer<typeof DevicesPullJob>;

/**
 * Маршруты событий для очередей devices (подключает worker.module.ts): свои события и подписка на удаление загрузки
 * провайдера (`tracks.upload-deleted` → надгробие импорта).
 */
export const devicesOutboxRoutes = {
  [DEVICES_CONNECTED]: QUEUE.devicesSync,
  [DEVICES_REVOKE_REQUESTED]: QUEUE.devicesSync,
  [TRACK_UPLOAD_DELETED]: QUEUE.devicesSync,
} as const;
