import { isNetworkError } from '@pokatim/api-client';
import { ROUTE_RIDE_MAX_PER_ROUTE } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { actionErrorMessage, apiErrorCode, retryAfterSec } from '@/features/auth/error-messages';

/** Часовой лимит проверок без деталей — «через 60 мин.». */
const DEFAULT_RETRY_MINUTES = 60;

/**
 * Отказы заезда по маршруту (route-rides-02) своими текстами (тексты сервера приложение не показывает): сеть — «Нет
 * соединения»; 429 — минуты до повтора (RC-10); коды `ROUTE_RIDE_*` и 404; прочее — общий текст действия.
 */
export function routeRideErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return t('auth.error.network');
  switch (apiErrorCode(error)) {
    case 'RATE_LIMITED': {
      const sec = retryAfterSec(error);
      const minutes = sec === undefined ? DEFAULT_RETRY_MINUTES : Math.max(1, Math.ceil(sec / 60));
      return t('routes.rides.error.rateLimited', { minutes });
    }
    case 'ROUTE_RIDE_NOT_READY':
      return t('routes.rides.error.ROUTE_RIDE_NOT_READY');
    case 'ROUTE_RIDE_UPLOAD_FAILED':
      return t('routes.rides.error.ROUTE_RIDE_UPLOAD_FAILED');
    case 'ROUTE_RIDE_QUOTA_EXCEEDED':
      return t('routes.rides.error.ROUTE_RIDE_QUOTA_EXCEEDED', { limit: ROUTE_RIDE_MAX_PER_ROUTE });
    case 'NOT_FOUND':
      return t('routes.rides.error.NOT_FOUND');
    default:
      return actionErrorMessage(error);
  }
}
