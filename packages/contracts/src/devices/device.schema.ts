import { z } from 'zod';

import { tolerantEnum } from '../common.ts';

// справочники ответов: значения только добавляются в конец (старые сборки — `tolerantEnum`)
/** Провайдеры устройств v1 в порядке экрана (через агрегатор, ADR-0011). */
export const DEVICE_PROVIDERS = ['garmin', 'wahoo'] as const;
export const DEVICE_STATUSES = [
  'not_connected',
  'pending',
  'active',
  'disconnecting',
  'revoked',
] as const;
/** Проблема подключения, которую экран показывает с действием («Подключить снова», «Синхронизировать сейчас»). */
export const DEVICE_ISSUES = ['reauthorize', 'sync_failed', 'revoke_failed'] as const;
/** `result` возврата из авторизации (`devices/return`). */
export const DEVICE_RETURN_RESULTS = ['pending', 'error'] as const;

/** Провайдер в пути запроса — строго. */
export const DeviceProvider = z.enum(DEVICE_PROVIDERS);
export type DeviceProvider = z.infer<typeof DeviceProvider>;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
export type DeviceIssue = (typeof DEVICE_ISSUES)[number];

/** Одноразовый тикет активации подключения: 32 байта base64url. */
export const DeviceLinkTicket = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * Провайдер на экране «Устройства» (ответ приложения, `no-store`): `available` — включён в агрегаторе и в allowlist
 * сервера; без идентификаторов агрегатора и провайдера.
 */
export const DeviceView = z.object({
  provider: tolerantEnum(DEVICE_PROVIDERS),
  name: z.string(),
  available: z.boolean(),
  status: tolerantEnum(DEVICE_STATUSES),
  issue: tolerantEnum(DEVICE_ISSUES).nullable(),
  connectedAt: z.iso.datetime().nullable(),
  lastSyncedAt: z.iso.datetime().nullable(),
});
export type DeviceView = z.infer<typeof DeviceView>;

/** `GET /v1/devices`, ответ `complete`, `sync`, `disconnect`. */
export const DeviceList = z.object({ items: z.array(DeviceView) });
export type DeviceList = z.infer<typeof DeviceList>;

/** `POST /v1/devices/:provider/connect` — куда вернуть пользователя (allowlist проверяет сервер). */
export const ConnectDeviceRequest = z.strictObject({ returnUrl: z.string().min(1).max(300) });
export type ConnectDeviceRequest = z.infer<typeof ConnectDeviceRequest>;

/** Ссылка авторизации агрегатора: только `https`. */
export const ConnectDeviceResponse = z.object({ authorizeUrl: z.url({ protocol: /^https$/ }) });
export type ConnectDeviceResponse = z.infer<typeof ConnectDeviceResponse>;

/** `POST /v1/devices/:provider/complete` — активация подключения владельцем тикета (под входом). */
export const CompleteDeviceRequest = z.strictObject({ ticket: DeviceLinkTicket });
export type CompleteDeviceRequest = z.infer<typeof CompleteDeviceRequest>;

/** `POST /v1/devices/:provider/disconnect`; `deleteActivities` — удалить заезды этого провайдера (Q5). */
export const DisconnectDeviceRequest = z.strictObject({
  deleteActivities: z.boolean().default(false),
});
export type DisconnectDeviceRequest = z.infer<typeof DisconnectDeviceRequest>;

/**
 * Query возврата в приложение (`devices/return?provider&result&t`) после `GET /v1/devices/callback`: приложение
 * разбирает его перед `complete`; мусор — ошибка без запроса.
 */
export const DeviceReturnParams = z.object({
  provider: DeviceProvider,
  result: z.enum(DEVICE_RETURN_RESULTS),
  t: DeviceLinkTicket.optional(),
});
export type DeviceReturnParams = z.infer<typeof DeviceReturnParams>;
