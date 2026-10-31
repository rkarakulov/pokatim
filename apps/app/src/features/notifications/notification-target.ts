import { NotificationTarget } from '@pokatim/contracts';
import type { Href } from 'expo-router';

import { achievementPath } from '@/features/achievements/achievement-catalog';

/** Центр уведомлений — куда ведёт push без цели (сводка тихих часов) или с незнакомой целью. */
export const NOTIFICATIONS_PATH = '/notifications' as const;

/**
 * Путь экрана по цели уведомления (N10) — только из белого списка типов с `Uuid` или каноническим кодом билета (схема контрактов): адресов из
 * ответа или push не принимаем. Незнакомое, битое, `unknown`, `null` — `null` (перехода нет).
 */
export function notificationTargetPath(target: unknown): Href | null {
  const parsed = NotificationTarget.safeParse(target);
  if (!parsed.success) return null;
  const value = parsed.data;
  switch (value.type) {
    case 'race':
      return `/races/${value.raceId}`;
    case 'ride':
      return `/rides/${value.rideId}`;
    case 'dispute-response':
      return `/races/dispute-response/${value.raceId}/${value.disputeId}`;
    case 'my-route':
      return `/routes/mine/${value.routeId}`;
    case 'ticket':
      return `/tickets/${value.code}`;
    case 'profile-edit':
      return '/settings/profile';
    case 'achievement':
      return achievementPath(value.code, value.seasonId ?? null) as Href;
    case 'rider':
      return `/riders/${value.publicId}`;
  }
}

/** Нажатие на push: цель из белого списка, иначе — центр уведомлений. */
export const pushTargetPath = (target: unknown): Href =>
  notificationTargetPath(target) ?? NOTIFICATIONS_PATH;
