import { ValidationErrorDetails } from '@pokatim/contracts';
import { apiErrorOf } from '@pokatim/api-client';
import { type MessageKey, type MessageParams, t } from '@pokatim/i18n';

const FIELD_ERROR_KEYS: Record<string, MessageKey> = {
  REQUIRED: 'field.error.REQUIRED',
  INVALID: 'field.error.INVALID',
  INVALID_EMAIL: 'field.error.INVALID_EMAIL',
  TOO_SHORT: 'field.error.TOO_SHORT',
  TOO_LONG: 'field.error.TOO_LONG',
  INVALID_DATE: 'field.error.INVALID_DATE',
  // правила расписания (admin-02): коды сервера под полем
  SEASON_OVERLAP: 'field.error.SEASON_OVERLAP',
  SEASON_IN_PAST: 'field.error.SEASON_IN_PAST',
  SEASON_FINISHED: 'field.error.SEASON_FINISHED',
  SEASON_EXCLUDES_RACES: 'field.error.SEASON_EXCLUDES_RACES',
  DATE_ORDER: 'field.error.DATE_ORDER',
  WINDOW_IN_PAST: 'field.error.WINDOW_IN_PAST',
  OUTSIDE_SEASON: 'field.error.OUTSIDE_SEASON',
  PROTOCOL_TOO_EARLY: 'field.error.PROTOCOL_TOO_EARLY',
  PROTOCOL_ONLY_LATER: 'field.error.PROTOCOL_ONLY_LATER',
  FIELD_LOCKED: 'field.error.FIELD_LOCKED',
};

/** Код ошибки поля из схемы контракта (сообщение zod = код) → текст; незнакомый — «Проверьте значение». */
export function fieldErrorText(
  code: string | undefined,
  params?: MessageParams,
): string | undefined {
  if (!code) return undefined;
  return t(FIELD_ERROR_KEYS[code] ?? 'field.error.INVALID', params);
}

/** Ошибки полей из ответа `400 VALIDATION_FAILED` (`details.fields`): путь → код; иначе `undefined`. */
export function serverFieldErrors(error: unknown): { path: string; code: string }[] | undefined {
  const apiError = apiErrorOf(error);
  if (apiError?.code !== 'VALIDATION_FAILED') return undefined;
  const details = ValidationErrorDetails.safeParse(apiError.details);
  return details.success ? details.data.fields : undefined;
}
