import {
  addLocalDays,
  DEFAULT_EVENT_NOTIFICATION_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_ROUTE_NOTIFICATION_SETTINGS,
  minskWallTimeToUtc,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationKind,
  type NotificationSettings,
  utcToMinskWallTime,
} from '@pokatim/contracts';

import type { EmailDelivery, PushDelivery } from './notifications.collection';

/**
 * Сроки и лимиты центра уведомлений (`docs/product/notifications.md`, task §11): хранение 90 дней (N8), ≤ 10 токенов
 * на пользователя (11-й вытесняет старейший), лимиты мутаций по `uid` (`RateLimiter` базы).
 */
export const NOTIFICATIONS_POLICY = {
  ttlDays: 90,
  maxTokensPerUser: 10,
  settingsLimit: { limit: 30, windowSec: 3600 },
  pushTokenLimit: { limit: 30, windowSec: 3600 },
  readLimit: { limit: 120, windowSec: 60 },
  /** Не больше 20 push в час на райдера (N7); сводка — один push. Сверх — только центр (`limited`). */
  pushLimit: { limit: 20, windowSec: 3600 },
  /** Захват отправки push и письма: упавший worker отпускает его по истечении (at-least-once). */
  deliveryLeaseMs: 60_000,
  /** Регламент: `pending` старше 10 мин после `notBefore` (письмо — после создания) — задача потеряна. */
  redeliverAfterMs: 10 * 60_000,
  redeliverBatch: 500,
  /** Квитанции Expo готовы не раньше 15 мин после отправки; пачка `getReceipts` — до 1000 id. */
  receiptsAfterMs: 15 * 60_000,
  receiptsBatch: 1000,
  receiptsMaxBatches: 10,
} as const;

// группы — из справочника контракта: строковый литерал группы споров совпал бы с именем коллекции споров (сторож
// `disputes.repository.test.ts`)
const [RACES, DISPUTES, RIDES, EVENTS, ROUTES] = NOTIFICATION_GROUPS;

const KIND_GROUPS: Record<NotificationKind, NotificationGroup> = {
  result_counted: RACES,
  result_rejected: RACES,
  protocol_published: RACES,
  protocol_disqualified: RACES,
  protocol_restored: RACES,
  protocol_rechecked: RACES,
  dispute_filed: DISPUTES,
  dispute_withdrawn: DISPUTES,
  dispute_responded: DISPUTES,
  dispute_decided: DISPUTES,
  ride_cancelled: RIDES,
  ride_rescheduled: RIDES,
  ride_joined: RIDES,
  ride_report_resolved: RIDES,
  route_published: ROUTES,
  route_rejected: ROUTES,
  event_reminder: EVENTS,
};

/** Группа настроек события (N4). */
export function groupOf(kind: NotificationKind): NotificationGroup {
  return KIND_GROUPS[kind];
}

/** События с письмом (N2): «Решение по спору», «Райд отменён», напоминание о событии (PR D). */
export const EMAIL_KINDS: ReadonlySet<NotificationKind> = new Set([
  'dispute_decided',
  'ride_cancelled',
  'event_reminder',
]);

/**
 * Настройки доставки (внутренний тип): основные `NotificationSettings` + тумблеры группы «Мероприятия»
 * (`push.events`, `email.events` — подресурс настроек, RC-D1; нет поля — включено) и «Маршруты» (`push.routes`, только
 * push; нет поля — значение `push.rides`). Хранятся в одном документе.
 */
export interface DeliverySettings {
  push: Record<NotificationGroup, boolean>;
  email: Record<Exclude<NotificationGroup, 'races' | 'routes'>, boolean>;
  quietHours: NotificationSettings['quietHours'];
}

/** Нет документа настроек — всё включено (N4), тихие часы 22–8 (N6). */
export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  push: {
    ...DEFAULT_NOTIFICATION_SETTINGS.push,
    events: DEFAULT_EVENT_NOTIFICATION_SETTINGS.push,
    routes: DEFAULT_ROUTE_NOTIFICATION_SETTINGS.push,
  },
  email: {
    ...DEFAULT_NOTIFICATION_SETTINGS.email,
    events: DEFAULT_EVENT_NOTIFICATION_SETTINGS.email,
  },
  quietHours: DEFAULT_NOTIFICATION_SETTINGS.quietHours,
};

const pad = (hour: number) => String(hour).padStart(2, '0');

/**
 * Конец тихих часов, если `now` внутри них (N6), иначе `null`. Часы — целые по Минску (`PLATFORM_TIME_ZONE`, функции
 * `time.ts`); интервал может переходить через полночь; начало включительно, конец — нет. Push откладывается до
 * результата (`notBefore = quietUntil ?? now`), письма тихие часы не задерживают.
 */
export function quietUntil(now: Date, quietHours: DeliverySettings['quietHours']): Date | null {
  const { enabled, startHour, endHour } = quietHours;
  if (!enabled || startHour === endHour) return null;
  const wall = utcToMinskWallTime(now.toISOString());
  const hour = Number(wall.slice(11, 13));
  const inside =
    startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
  if (!inside) return null;
  const today = wall.slice(0, 10);
  const day = hour < endHour ? today : addLocalDays(today, 1);
  return new Date(minskWallTimeToUtc(`${day}T${pad(endHour)}:00`));
}

/**
 * Доставка нового уведомления (intake): push `pending` с `notBefore` = конец тихих часов или сейчас — при включённой
 * группе и включённом канале push (`pushChannelEnabled`: Expo или Web Push), иначе `skipped` (`disabled` / `push_off`); письмо — только N2 (`EMAIL_KINDS`) по тумблеру
 * группы (`skipped`, если выключен), прочим — `null`. В центр уведомление пишется всегда (N4, RC-13).
 */
export function initialDelivery(
  kind: NotificationKind,
  settings: DeliverySettings,
  now: Date,
  pushEnabled: boolean,
): { push: PushDelivery; email: EmailDelivery | null } {
  const group = groupOf(kind);
  const reason = !pushEnabled ? 'push_off' : settings.push[group] ? null : 'disabled';
  const push: PushDelivery = {
    state: reason === null ? 'pending' : 'skipped',
    notBefore: reason === null ? (quietUntil(now, settings.quietHours) ?? now) : now,
    claimId: null,
    claimedUntil: null,
    sentAt: null,
    reason,
  };
  if (!EMAIL_KINDS.has(kind) || group === RACES || group === ROUTES) return { push, email: null };
  return {
    push,
    email: {
      state: settings.email[group] ? 'pending' : 'skipped',
      claimedUntil: null,
      sentAt: null,
    },
  };
}
