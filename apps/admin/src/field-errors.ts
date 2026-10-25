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

/**
 * Код ошибки поля RHF, включая вложенные (`distancesKm.0` — ошибка элемента массива): первый найденный `message`.
 * Строковое поле формы, разбираемое схемой в массив, показывает ошибку элемента под собой.
 */
export function errorCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { message } = error as { message?: unknown };
  if (typeof message === 'string' && message) return message;
  for (const [key, nested] of Object.entries(error)) {
    if (key === 'ref' || key === 'type' || key === 'types') continue;
    const code = errorCodeOf(nested);
    if (code) return code;
  }
  return undefined;
}

/** Поле формы для пути ошибки сервера: вложенный путь (`distancesKm.0`) — поле целиком. */
export const formFieldOf = (path: string) => path.split('.')[0] ?? path;
