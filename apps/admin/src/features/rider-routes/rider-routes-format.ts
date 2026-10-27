import { apiErrorOf } from '@pokatim/api-client';
import {
  RIDER_ROUTE_MODERATION_STATES,
  type RiderRouteModerationState,
  type RoutePublicationStatus,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { httpStatus } from '../../session/errors';

/** Вкладка очереди из URL (`?tab=reported|hidden`); прочее — `pending` (без параметра). */
export interface RiderRoutesSearch {
  tab?: RiderRouteModerationState;
}

export function validateRiderRoutesSearch(search: Record<string, unknown>): RiderRoutesSearch {
  const tab = search.tab as RiderRouteModerationState;
  return RIDER_ROUTE_MODERATION_STATES.includes(tab) && tab !== 'pending' ? { tab } : {};
}

/** Тон статуса заявки: на проверке — ink (ждёт решения), в каталоге — успех, отклонён — нейтральный, скрыт — ошибка. */
export const RIDER_ROUTE_STATUS_TONE: Record<
  RoutePublicationStatus,
  'ink' | 'success' | 'neutral' | 'error'
> = {
  pending: 'ink',
  approved: 'success',
  rejected: 'neutral',
  hidden: 'error',
};

export const riderRouteStatusLabel = (status: RoutePublicationStatus) =>
  t(`admin.riderRoutes.status.${status}`);

/** Автор заявки — только хвост id, без имени и e-mail (N8): «Райдер ·b3020a». */
export const riderRouteAuthor = (userId: string) =>
  t('admin.riderRoutes.author', { id: userId.slice(-6) });

/**
 * Заявку уже изменили: 409 `CONFLICT` (версия, новая жалоба), 409 `ROUTE_INVALID_STATE` (другое состояние) и 404
 * (автор отозвал или удалил маршрут, RC-10) — баннер «обновите страницу», а не ошибка в окне.
 */
export const isStaleRiderRoute = (error: unknown) => {
  const status = httpStatus(error);
  if (status === 404) return true;
  if (status !== 409) return false;
  const code = apiErrorOf(error)?.code;
  return code === 'CONFLICT' || code === 'ROUTE_INVALID_STATE';
};
