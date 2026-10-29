import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { ProfileStateDetails } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { apiErrorCode } from '@/features/auth/error-messages';

/**
 * Отказы жалобы на профиль (profile-report-app): свой профиль — по `details.reason`, 429, 404 — «Профиль недоступен»;
 * сеть — «Нет соединения», прочее — общий текст.
 */
export function riderReportErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return t('auth.error.network');
  switch (apiErrorCode(error)) {
    case 'PROFILE_INVALID_STATE': {
      const details = ProfileStateDetails.safeParse(apiErrorOf(error)?.details);
      return details.success && details.data.reason === 'own_profile'
        ? t('riders.report.own')
        : t('riders.report.failed');
    }
    case 'RATE_LIMITED':
      return t('riders.report.rateLimited');
    case 'NOT_FOUND':
      return t('riders.notFound');
    default:
      return t('riders.report.failed');
  }
}
