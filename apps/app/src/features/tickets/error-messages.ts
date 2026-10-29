import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { EventRegistrationClosedDetails } from '@pokatim/contracts';
import { t, type MessageKey } from '@pokatim/i18n';

const CLOSED: Record<EventRegistrationClosedDetails['reason'], MessageKey> = {
  started: 'tickets.error.closed.started',
  unpublished: 'tickets.error.closed.unpublished',
  cancelled: 'tickets.error.closed.cancelled',
  not_enabled: 'tickets.error.closed.notEnabled',
  checked_in: 'tickets.error.closed.checkedIn',
  unknown: 'tickets.error.closed.unknown',
};

/**
 * Текст отказа регистрации на старт и её отмены (баннер у кнопки): мест нет, регистрация закрыта (по `reason`
 * сервера), дистанция, лимит, сеть, прочее. Решает только сервер — клиент «полон/закрыт» не вычисляет.
 */
export function ticketErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return t('tickets.error.network');
  const parsed = apiErrorOf(error);
  switch (parsed?.code) {
    case 'EVENT_FULL':
      return t('tickets.error.full');
    case 'EVENT_REGISTRATION_CLOSED': {
      const details = EventRegistrationClosedDetails.safeParse(parsed.details);
      return t(CLOSED[details.success ? details.data.reason : 'unknown']);
    }
    case 'VALIDATION_FAILED':
      return t('tickets.error.distance');
    case 'RATE_LIMITED':
      return t('tickets.error.rateLimited');
    default:
      return t('tickets.error.failed');
  }
}

/** Отказ означает, что сводка регистрации устарела (места, «открыта»): её нужно перезапросить. */
export function isStaleTicketingError(error: unknown): boolean {
  const code = apiErrorOf(error)?.code;
  return code === 'EVENT_FULL' || code === 'EVENT_REGISTRATION_CLOSED';
}
