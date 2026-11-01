import { apiErrorOf } from '@pokatim/api-client';
import { ImageInvalidDetails } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { apiErrorCode, retryAfterSec } from '@/features/auth/error-messages';
import { ImagePickerUnavailableError, ImagePrecheckError } from '@/features/media/picked-image';
import { formatCountdown } from '@/lib/countdown';

import { rideActionErrorText } from '../queries';

/** Отказы фото с понятным текстом (413, 415, 422 `IMAGE_*`, ADR-0028). */
const CODE_MESSAGES = {
  IMAGE_FORMAT_UNSUPPORTED: 'rideInvite.photo.error.IMAGE_FORMAT_UNSUPPORTED',
  IMAGE_TOO_LARGE: 'rideInvite.photo.error.IMAGE_TOO_LARGE',
  IMAGE_INVALID: 'rideInvite.photo.error.IMAGE_INVALID',
} as const;

const PRECHECK_MESSAGES = {
  tooLarge: CODE_MESSAGES.IMAGE_TOO_LARGE,
  formatUnsupported: CODE_MESSAGES.IMAGE_FORMAT_UNSUPPORTED,
} as const;

/** Пауза 429 занятого слота или обработки фото на сервере (`ride-photos.service.ts`, `limited(5)`); часовой лимит — дольше. */
const BUSY_RETRY_SEC = 5;

const isKnownCode = (code: string | undefined): code is keyof typeof CODE_MESSAGES =>
  code !== undefined && code in CODE_MESSAGES;

/** 422 `IMAGE_INVALID { reason: 'too_small' }` — короткая сторона после вписывания меньше 400 px. */
function tooSmall(error: unknown): boolean {
  const details = ImageInvalidDetails.safeParse(apiErrorOf(error)?.details);
  return details.success && details.data.reason === 'too_small';
}

/**
 * Текст баннера блока «Своё фото» (выбор, загрузка, удаление): старый dev-клиент — «Обновите приложение»; проверка до
 * отправки — тот же текст, что у ответа сервера; 422 `too_small` — «слишком маленькое»; 409 — «только к будущему райду»;
 * 429 загрузки с паузой занятой обработки — «подождите», иначе — лимит загрузок и когда повторить. Удаление (лимит
 * изменений райда), сеть и прочее — тексты действий с райдом (`rideActionErrorText`).
 */
export function ridePhotoErrorMessage(
  error: unknown,
  action: 'upload' | 'delete' = 'upload',
): string {
  if (error instanceof ImagePickerUnavailableError) return t('rideInvite.photo.error.updateApp');
  if (error instanceof ImagePrecheckError) return t(PRECHECK_MESSAGES[error.reason]);
  if (action === 'delete') return rideActionErrorText(error, null);
  const code = apiErrorCode(error);
  if (code === 'IMAGE_INVALID' && tooSmall(error)) return t('rideInvite.photo.error.tooSmall');
  if (isKnownCode(code)) return t(CODE_MESSAGES[code]);
  if (code === 'RIDE_INVALID_STATE') return t('rideInvite.photo.error.invalidState');
  const wait = code === 'RATE_LIMITED' ? retryAfterSec(error) : undefined;
  if (wait !== undefined && wait <= BUSY_RETRY_SEC) return t('rideInvite.photo.error.busy');
  if (wait !== undefined) {
    return t('rideInvite.photo.error.rateLimited', { time: formatCountdown(wait) });
  }
  return rideActionErrorText(error, null);
}
