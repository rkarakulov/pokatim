import { type MessageKey, type MessageParams, t } from '@pokatim/i18n';

const FIELD_ERROR_KEYS: Record<string, MessageKey> = {
  REQUIRED: 'field.error.REQUIRED',
  INVALID: 'field.error.INVALID',
  INVALID_EMAIL: 'field.error.INVALID_EMAIL',
  TOO_SHORT: 'field.error.TOO_SHORT',
  TOO_LONG: 'field.error.TOO_LONG',
};

/** Код ошибки поля из схемы контракта (сообщение zod = код) → текст; незнакомый — «Проверьте значение». */
export function fieldErrorText(
  code: string | undefined,
  params?: MessageParams,
): string | undefined {
  if (!code) return undefined;
  return t(FIELD_ERROR_KEYS[code] ?? 'field.error.INVALID', params);
}
