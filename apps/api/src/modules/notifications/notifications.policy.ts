import {
  addLocalDays,
  minskWallTimeToUtc,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  type NotificationKind,
  type NotificationSettings,
  utcToMinskWallTime,
} from '@pokatim/contracts';

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
} as const;

// группы — из справочника контракта: строковый литерал группы споров совпал бы с именем коллекции споров (сторож
// `disputes.repository.test.ts`)
const [RACES, DISPUTES, RIDES] = NOTIFICATION_GROUPS;

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
};

/** Группа настроек события (N4). */
export function groupOf(kind: NotificationKind): NotificationGroup {
  return KIND_GROUPS[kind];
}

/** События с письмом (N2): «Решение по спору» и «Райд отменён». */
export const EMAIL_KINDS: ReadonlySet<NotificationKind> = new Set([
  'dispute_decided',
  'ride_cancelled',
]);

const pad = (hour: number) => String(hour).padStart(2, '0');

/**
 * Конец тихих часов, если `now` внутри них (N6), иначе `null`. Часы — целые по Минску (`PLATFORM_TIME_ZONE`, функции
 * `time.ts`); интервал может переходить через полночь; начало включительно, конец — нет. Push откладывается до
 * результата (`notBefore = quietUntil ?? now`), письма тихие часы не задерживают.
 */
export function quietUntil(now: Date, quietHours: NotificationSettings['quietHours']): Date | null {
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
