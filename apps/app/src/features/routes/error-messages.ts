import { isNetworkError } from '@pokatim/api-client';
import { MY_ROUTE_MAX_COUNT } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

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
