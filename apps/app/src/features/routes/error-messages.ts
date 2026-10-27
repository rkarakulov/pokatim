import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  MY_ROUTE_MAX_COUNT,
  RoutePublicationLimitDetails,
  RouteStateDetails,
} from '@pokatim/contracts';
import { t, type MessageKey } from '@pokatim/i18n';

import { apiErrorCode } from '@/features/auth/error-messages';

/** Отказы загрузки своего маршрута (routes-02) с понятным текстом; сеть — «Нет соединения», прочее — общий текст. */
export function myRouteErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return t('auth.error.network');
  switch (apiErrorCode(error)) {
    case 'ROUTE_FORMAT_UNSUPPORTED':
      return t('routes.mine.error.ROUTE_FORMAT_UNSUPPORTED');
    case 'ROUTE_TOO_LARGE':
      return t('routes.mine.error.ROUTE_TOO_LARGE');
    case 'RATE_LIMITED':
      return t('routes.mine.error.RATE_LIMITED');
    case 'ROUTE_QUOTA_EXCEEDED':
      return t('routes.mine.error.ROUTE_QUOTA_EXCEEDED', { limit: MY_ROUTE_MAX_COUNT });
    default:
      return t('routes.mine.error.generic');
  }
}

const STATE_REASONS = {
  not_ready: 'routes.mine.error.ROUTE_INVALID_STATE.not_ready',
  in_review: 'routes.mine.error.ROUTE_INVALID_STATE.in_review',
  published: 'routes.mine.error.ROUTE_INVALID_STATE.published',
  hidden: 'routes.mine.error.ROUTE_INVALID_STATE.hidden',
  own_route: 'routes.mine.error.ROUTE_INVALID_STATE.own_route',
  team_route: 'routes.mine.error.ROUTE_INVALID_STATE.team_route',
} as const satisfies Record<string, MessageKey>;

/** Текст `409 ROUTE_INVALID_STATE` по `details.reason` (routes-06); без `details` или незнакомая — `null`. */
function invalidStateText(error: unknown): string | null {
  const details = RouteStateDetails.safeParse(apiErrorOf(error)?.details);
  if (!details.success || details.data.reason === 'unknown') return null;
  return t(STATE_REASONS[details.data.reason]);
}

/**
 * Отказы публикации своего маршрута (routes-06): подать, отозвать, снять. Лимиты U8 — «на проверке уже 3» / «подавали
 * уже 3 раза»; состояние — по `details.reason`; 429 — «слишком много заявок за сутки»; 404 — «Маршрут недоступен».
 */
export function routePublicationErrorMessage(error: unknown, fallback: MessageKey): string {
  if (isNetworkError(error)) return t('auth.error.network');
  switch (apiErrorCode(error)) {
    case 'ROUTE_PUBLICATION_LIMIT': {
      const details = RoutePublicationLimitDetails.safeParse(apiErrorOf(error)?.details);
      if (details.success && details.data.limit !== 'unknown') {
        return t(`routes.mine.error.ROUTE_PUBLICATION_LIMIT.${details.data.limit}`, {
          max: details.data.max,
        });
      }
      return t(fallback);
    }
    case 'ROUTE_INVALID_STATE':
      return invalidStateText(error) ?? t(fallback);
    case 'RATE_LIMITED':
      return t('routes.publish.rateLimited');
    case 'NOT_FOUND':
      return t('routes.mine.detail.notFound');
    default:
      return t(fallback);
  }
}

/** Отказы жалобы на маршрут (routes-06, A4): свой / команды — по `details.reason`, 429, 404 — «Маршрут недоступен». */
export function routeReportErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return t('auth.error.network');
  switch (apiErrorCode(error)) {
    case 'ROUTE_INVALID_STATE':
      return invalidStateText(error) ?? t('routes.report.failed');
    case 'RATE_LIMITED':
      return t('routes.report.rateLimited');
    case 'NOT_FOUND':
      return t('routes.detail.notFound');
    default:
      return t('routes.report.failed');
  }
}
