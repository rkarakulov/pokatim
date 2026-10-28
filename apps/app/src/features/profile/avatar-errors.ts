import { t } from '@pokatim/i18n';

import { actionErrorMessage, apiErrorCode, retryAfterSec } from '@/features/auth/error-messages';
import { formatCountdown } from '@/lib/countdown';

import { AvatarPickerUnavailableError, AvatarPrecheckError } from './picked-avatar';

/** Отказы фото с понятным текстом (413, 415, 422); прочее — общий текст действия. */
const CODE_MESSAGES = {
  AVATAR_FORMAT_UNSUPPORTED: 'profile.avatar.error.AVATAR_FORMAT_UNSUPPORTED',
  AVATAR_TOO_LARGE: 'profile.avatar.error.AVATAR_TOO_LARGE',
  AVATAR_INVALID: 'profile.avatar.error.AVATAR_INVALID',
} as const;

/** Пауза 429 занятой обработки фото на сервере (`profile-avatar.service.ts`, `limited(5)`); часовой лимит — дольше. */
const BUSY_RETRY_SEC = 5;

const isKnownCode = (code: string | undefined): code is keyof typeof CODE_MESSAGES =>
  code !== undefined && code in CODE_MESSAGES;

/**
 * Текст баннера блока «Фото» (выбор, загрузка, удаление): старый dev-клиент — «Обновите приложение»; проверка до
 * отправки — тот же текст, что у ответа сервера; 429 загрузки с паузой занятой обработки — «через минуту», иначе — лимит
 * загрузок и когда повторить; удаление, сеть и прочее — `actionErrorMessage`.
 */
export function avatarErrorMessage(error: unknown, action: 'upload' | 'delete' = 'upload'): string {
  if (error instanceof AvatarPickerUnavailableError) return t('profile.avatar.error.updateApp');
  if (error instanceof AvatarPrecheckError) {
    return error.reason === 'tooSmall'
      ? t('profile.avatar.error.tooSmall')
      : t(CODE_MESSAGES[error.reason]);
  }
  const code = apiErrorCode(error);
  if (isKnownCode(code)) return t(CODE_MESSAGES[code]);
  // удаление — лимит изменений профиля, не загрузок: общий текст действия
  if (action === 'delete') return actionErrorMessage(error);
  const wait = retryAfterSec(error);
  if (wait !== undefined && wait <= BUSY_RETRY_SEC) return t('profile.avatar.error.busy');
  if (wait !== undefined) {
    return t('profile.avatar.error.rateLimited', { time: formatCountdown(wait) });
  }
  return actionErrorMessage(error);
}
