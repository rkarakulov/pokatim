import { z } from 'zod';

import { fieldError, tolerantEnum, Uuid } from '../common.ts';
import { PageCursor } from '../races/race.schema.ts';

/**
 * Центр уведомлений (ADR-0017, `docs/product/notifications.md`). Все эндпоинты — под `AuthGuard`, только свои
 * уведомления. Тексты и цели считает сервер при создании (снимок); клиент присылает только намерение (прочитать,
 * настройки, токен). Справочники — только в конец: ответы приложения разбирают их `tolerantEnum`.
 */
export const NOTIFICATION_GROUPS = ['races', 'disputes', 'rides'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const NOTIFICATION_KINDS = [
  'result_counted',
  'result_rejected',
  'protocol_published',
  'protocol_disqualified',
  'protocol_restored',
  'protocol_rechecked',
  'dispute_filed',
  'dispute_withdrawn',
  'dispute_responded',
  'dispute_decided',
  'ride_cancelled',
  'ride_rescheduled',
  'ride_joined',
  'ride_report_resolved',
  'route_published',
  'route_rejected',
  // profile-moderation-followups: модератор сбросил имя, фото или клуб профиля (самому райдеру)
  'profile_name_reset',
  'profile_avatar_reset',
  'profile_club_reset',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Цель deep link (N10): тип + id из белого списка, адресов нет. Приложение строит путь только по этим типам.
 */
export const NotificationTarget = z.discriminatedUnion('type', [
  z.object({ type: z.literal('race'), raceId: Uuid }),
  z.object({ type: z.literal('ride'), rideId: Uuid }),
  z.object({ type: z.literal('dispute-response'), raceId: Uuid, disputeId: Uuid }),
  /** свой маршрут райдера (`/routes/mine/<id>`): решение по заявке в каталог (routes-06 A6) */
  z.object({ type: z.literal('my-route'), routeId: Uuid }),
  /** свой профиль («Редактировать профиль», `/settings/profile`): модератор сбросил имя, фото или клуб */
  z.object({ type: z.literal('profile-edit') }),
]);
export type NotificationTarget = z.infer<typeof NotificationTarget>;

/** Цель в ответе: незнакомый тип (новый сервер, старая сборка) или битый id — `{ type: 'unknown' }`, без перехода. */
export const NotificationTargetView = z.union([
  NotificationTarget,
  z.object({ type: z.string() }).transform(() => ({ type: 'unknown' as const })),
]);
export type NotificationTargetView = z.output<typeof NotificationTargetView>;

/** Уведомление центра: снимок текста на момент создания; `read` — нажатие или «Прочитать все». */
export const NotificationView = z.object({
  id: Uuid,
  kind: tolerantEnum(NOTIFICATION_KINDS),
  group: tolerantEnum(NOTIFICATION_GROUPS),
  title: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  read: z.boolean(),
  target: NotificationTargetView.nullable(),
});
export type NotificationView = z.output<typeof NotificationView>;

/** `GET /v1/notifications` → новые сверху, курсор по `(createdAt, id)`. */
export const NotificationPage = z.object({
  items: z.array(NotificationView),
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.output<typeof NotificationPage>;

export const NOTIFICATION_LIST_MAX_LIMIT = 50;

/** `GET /v1/notifications?cursor&limit` — лишние ключи — 400. */
export const NotificationListQuery = z.strictObject({
  cursor: PageCursor.optional(),
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_LIST_MAX_LIMIT).default(20),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuery>;

/** Потолок счётчика: колокольчик показывает «99+», точнее сервер не считает. */
export const UNREAD_COUNT_MAX = 100;

/** `GET /v1/notifications/unread-count`. */
export const UnreadCount = z.object({ count: z.number().int().min(0).max(UNREAD_COUNT_MAX) });
export type UnreadCount = z.infer<typeof UnreadCount>;

const Toggle = z.boolean({ error: fieldError('INVALID') });
const Hour = z
  .number({ error: fieldError('INVALID') })
  .int({ error: 'INVALID' })
  .min(0, { error: 'INVALID' })
  .max(23, { error: 'INVALID' });

/**
 * Настройки (N4, N6): push по трём группам, e-mail — только группы событий N2; тихие часы — целые часы по Минску,
 * интервал может переходить через полночь, начало ≠ концу. `PUT` — полный объект.
 */
export const NotificationSettings = z.strictObject({
  push: z.strictObject({ races: Toggle, disputes: Toggle, rides: Toggle }),
  email: z.strictObject({ disputes: Toggle, rides: Toggle }),
  quietHours: z
    .strictObject({ enabled: Toggle, startHour: Hour, endHour: Hour })
    .refine((value) => value.startHour !== value.endHour, {
      error: 'INVALID',
      path: ['endHour'],
    }),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

/** Нет документа настроек — эти значения (N4: всё включено; N6: тихие часы 22–8). */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  push: { races: true, disputes: true, rides: true },
  email: { disputes: true, rides: true },
  quietHours: { enabled: true, startHour: 22, endHour: 8 },
};

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Токен Expo Push: `ExpoPushToken[…]` или `ExponentPushToken[…]`, без пробелов и управляющих символов. */
export const ExpoPushToken = z
  .string({ error: fieldError('INVALID') })
  .max(220, { error: 'INVALID' })
  .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/, { error: 'INVALID' });

/** `PUT /v1/notifications/push-tokens` — регистрация или обновление токена этого устройства; ответ `204`. */
export const RegisterPushToken = z.strictObject({
  token: ExpoPushToken,
  platform: z.enum(PUSH_PLATFORMS, { error: fieldError('INVALID') }),
});
export type RegisterPushToken = z.infer<typeof RegisterPushToken>;

/** `POST /v1/notifications/push-tokens/revoke` — снять токен этого устройства (до выхода); ответ `204` всегда. */
export const RevokePushToken = z.strictObject({ token: ExpoPushToken });
export type RevokePushToken = z.infer<typeof RevokePushToken>;

// --- Web Push (ADR-0022): второй транспорт канала push — PWA в браузере ---

/**
 * Хосты push-сервисов браузеров (FCM — Chrome, Edge на Android, Samsung, Opera; Mozilla; WNS — Edge на Windows;
 * Apple — Safari и PWA на iOS 16.4+). Сервер шлёт POST на endpoint от клиента — другие адреса не принимаем (SSRF).
 */
const WEB_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

/**
 * `https://<хост>/<путь>`: хост — только буквы, цифры, `.` и `-` (без порта, учётных данных, `\`), путь — без пробелов
 * и управляющих символов. Разбор строкой: в пакете контрактов нет `URL`; адаптер сервера сверяет и нормализованный URL.
 */
const WEB_PUSH_URL = /^https:\/\/([a-z0-9.-]+)\/[^\s\\]*$/i;

/** Endpoint — https на хосте push-сервиса из белого списка. */
export function isWebPushEndpoint(value: string): boolean {
  const host = WEB_PUSH_URL.exec(value)?.[1]?.toLowerCase();
  return host !== undefined && WEB_PUSH_HOSTS.some((re) => re.test(host));
}

export const WEB_PUSH_ENDPOINT_MAX = 2048;

/** Адрес подписки `PushSubscription.endpoint`: https, ≤ 2048, хост — push-сервис из белого списка. */
export const WebPushEndpoint = z
  .string({ error: fieldError('INVALID') })
  .max(WEB_PUSH_ENDPOINT_MAX, { error: 'INVALID' })
  .refine(isWebPushEndpoint, { error: 'INVALID' });

/** base64url без `=` ровно на `bytes` байт. */
const base64Url = (bytes: number) =>
  z
    .string({ error: fieldError('INVALID') })
    .length(Math.ceil((bytes * 4) / 3), { error: 'INVALID' })
    .regex(/^[A-Za-z0-9_-]+$/, { error: 'INVALID' });

/**
 * `PUT /v1/notifications/web-push/subscriptions` — подписка этого браузера (`PushSubscription.toJSON()` без
 * `expirationTime`); ответ `204`. `p256dh` — несжатая точка P-256 (65 байт, `0x04…`), `auth` — 16 байт.
 */
export const RegisterWebPushSubscription = z.strictObject({
  endpoint: WebPushEndpoint,
  keys: z.strictObject({
    p256dh: base64Url(65).refine((key) => key.startsWith('B'), { error: 'INVALID' }),
    auth: base64Url(16),
  }),
});
export type RegisterWebPushSubscription = z.infer<typeof RegisterWebPushSubscription>;

/** `POST /v1/notifications/web-push/subscriptions/revoke` — снять подписку этого браузера; ответ `204` всегда. */
export const RevokeWebPushSubscription = z.strictObject({ endpoint: WebPushEndpoint });
export type RevokeWebPushSubscription = z.infer<typeof RevokeWebPushSubscription>;

/**
 * `GET /v1/notifications/web-push` — публичный VAPID-ключ (base64url, 65 байт) для `pushManager.subscribe`; `null` —
 * сервер Web Push не шлёт (опцию не показываем).
 */
export const WebPushConfig = z.object({ publicKey: base64Url(65).nullable() });
export type WebPushConfig = z.infer<typeof WebPushConfig>;
