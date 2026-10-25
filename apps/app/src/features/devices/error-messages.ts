import { t } from '@pokatim/i18n';

import { actionErrorMessage, apiErrorCode, retryAfterSec } from '@/features/auth/error-messages';
import { formatCountdown } from '@/lib/countdown';

import { DeviceConnectError } from './return-params';

/** Отказы загрузки и подключения с понятным текстом; прочее — общий текст действия (сеть, 429, сбой). */
const CODE_MESSAGES = {
  TRACK_FORMAT_UNSUPPORTED: 'tracks.error.TRACK_FORMAT_UNSUPPORTED',
  TRACK_TOO_LARGE: 'tracks.error.TRACK_TOO_LARGE',
  TRACK_STORAGE_FULL: 'tracks.error.TRACK_STORAGE_FULL',
  DEVICE_PROVIDER_UNAVAILABLE: 'devices.error.DEVICE_PROVIDER_UNAVAILABLE',
  DEVICE_LINK_INVALID: 'devices.error.DEVICE_LINK_INVALID',
  DEVICE_PROVIDER_ERROR: 'devices.error.DEVICE_PROVIDER_ERROR',
} as const;

const isKnownCode = (code: string | undefined): code is keyof typeof CODE_MESSAGES =>
  code !== undefined && code in CODE_MESSAGES;

/** Текст неудачного действия «Устройств» (загрузка, подключение, отключение, удаление) для баннера. */
export function deviceActionErrorMessage(error: unknown): string {
  if (error instanceof DeviceConnectError) return t('devices.connectFailed');
  const code = apiErrorCode(error);
  if (isKnownCode(code)) return t(CODE_MESSAGES[code]);
  return actionErrorMessage(error);
}

/** «Синхронизировать сейчас»: 429 — когда можно повторить (`retryAfterSec`), иначе — как прочие действия. */
export function syncErrorMessage(error: unknown): string {
  const wait = retryAfterSec(error);
  if (wait !== undefined) return t('devices.syncTooOften', { time: formatCountdown(wait) });
  return deviceActionErrorMessage(error);
}
