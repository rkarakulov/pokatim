import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { RateLimitedDetails } from '@pokatim/contracts';
import { type MessageKey, t } from '@pokatim/i18n';

const TOTP_ERROR_KEYS: Partial<Record<string, MessageKey>> = {
  TOTP_INVALID_CODE: 'admin.totp.error.TOTP_INVALID_CODE',
  TOTP_CHALLENGE_EXPIRED: 'admin.totp.error.TOTP_CHALLENGE_EXPIRED',
  TOTP_ALREADY_ENABLED: 'admin.totp.error.TOTP_ALREADY_ENABLED',
  TOTP_NOT_ENABLED: 'admin.totp.error.TOTP_NOT_ENABLED',
  TOTP_REQUIRED: 'admin.totp.error.TOTP_REQUIRED',
  TOTP_UNAVAILABLE: 'admin.totp.error.TOTP_UNAVAILABLE',
};

/** Код ошибки ответа API (или `undefined` — сеть, неизвестная ошибка). */
export const errorCodeOf = (error: unknown) => apiErrorOf(error)?.code;

/** Текст ошибки действия 2FA (вход, подключение, настройки): коды контракта, лимит попыток, сеть. */
export function totpErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('error.network');
  const apiError = apiErrorOf(error);
  if (apiError?.code === 'RATE_LIMITED') {
    const details = RateLimitedDetails.safeParse(apiError.details);
    const seconds = details.success ? details.data.retryAfterSec : 60;
    return t('admin.totp.error.rateLimited', { minutes: Math.max(1, Math.ceil(seconds / 60)) });
  }
  const key = TOTP_ERROR_KEYS[apiError?.code ?? ''];
  return key ? t(key) : t('error.unknown');
}
