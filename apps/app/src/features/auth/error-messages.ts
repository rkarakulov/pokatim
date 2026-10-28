import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  LinkExpiredDetails,
  PASSWORD_MIN_LENGTH,
  RateLimitedDetails,
  ValidationErrorDetails,
  type CorridorFieldErrorCode,
  type ErrorCode,
  type FieldErrorCode,
  type RideFieldErrorCode,
  type RideRouteFieldErrorCode,
  type ScheduleFieldErrorCode,
} from '@pokatim/contracts';
import { t, type MessageKey } from '@pokatim/i18n';

/** Коды, которые показываем у поля: коды zod-схемы + отказы сервера по e-mail (коды панели — не здесь). */
const FIELD_MESSAGES = {
  REQUIRED: 'auth.field.REQUIRED',
  INVALID: 'auth.field.INVALID',
  INVALID_EMAIL: 'auth.field.INVALID_EMAIL',
  TOO_SHORT: 'auth.field.TOO_SHORT',
  TOO_LONG: 'auth.field.TOO_LONG',
  INVALID_DATE: 'auth.field.INVALID_DATE',
  AGE_BELOW_18: 'auth.field.AGE_BELOW_18',
  CONSENT_REQUIRED: 'auth.field.CONSENT_REQUIRED',
  EMAIL_TAKEN: 'auth.field.EMAIL_TAKEN',
  EMAIL_UNAVAILABLE: 'auth.field.EMAIL_UNAVAILABLE',
} as const satisfies Record<
  | Exclude<
      FieldErrorCode,
      ScheduleFieldErrorCode | RideFieldErrorCode | CorridorFieldErrorCode | RideRouteFieldErrorCode
    >
  | 'EMAIL_TAKEN'
  | 'EMAIL_UNAVAILABLE',
  MessageKey
>;

const isFieldMessageCode = (code: string): code is keyof typeof FIELD_MESSAGES =>
  code in FIELD_MESSAGES;

/** Текст ошибки поля по коду (сообщение zod = код). Незнакомый код (сервер новее) — общий текст. */
export function fieldErrorMessage(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (!isFieldMessageCode(code)) return t('auth.field.INVALID');
  return t(FIELD_MESSAGES[code], { min: PASSWORD_MIN_LENGTH });
}

/** Код ответа API: `UNKNOWN` — незнакомый код или не-API ответ; `undefined` — ответа не было. */
export function apiErrorCode(error: unknown): ErrorCode | 'UNKNOWN' | undefined {
  return apiErrorOf(error)?.code;
}

/** Текст неудачного действия (мутации) для баннера рядом с кнопкой. */
export function actionErrorMessage(error: unknown): string {
  if (isNetworkError(error)) return t('auth.error.network');
  if (apiErrorCode(error) === 'RATE_LIMITED') return t('auth.error.rateLimited');
  return t('auth.error.unknown');
}

/** Текст отказа входа (кроме 429 — у него отсчёт): неверные данные — один нейтральный текст (без оракула). */
export function signInErrorMessage(error: unknown): string {
  if (apiErrorCode(error) === 'INVALID_CREDENTIALS') return t('auth.signIn.invalidCredentials');
  return actionErrorMessage(error);
}

/** Пауза из ответа 429 (`details.retryAfterSec`). */
export function retryAfterSec(error: unknown): number | undefined {
  const apiError = apiErrorOf(error);
  if (apiError?.code !== 'RATE_LIMITED') return undefined;
  const details = RateLimitedDetails.safeParse(apiError.details);
  return details.success ? details.data.retryAfterSec : undefined;
}

/** Ошибки полей из 400 `VALIDATION_FAILED` — только для полей этой формы. */
export function serverFieldErrors<F extends string>(
  error: unknown,
  fields: readonly F[],
): { field: F; code: FieldErrorCode }[] {
  const apiError = apiErrorOf(error);
  if (apiError?.code !== 'VALIDATION_FAILED') return [];
  const details = ValidationErrorDetails.safeParse(apiError.details);
  if (!details.success) return [];
  return details.data.fields.flatMap(({ path, code }) => {
    const field = fields.find((name) => name === path);
    return field ? [{ field, code }] : [];
  });
}

/** E-mail из 410 `LINK_EXPIRED` (`details.email`) — кому отправить новую ссылку. */
export function linkExpiredEmail(error: unknown): string | undefined {
  const apiError = apiErrorOf(error);
  if (apiError?.code !== 'LINK_EXPIRED') return undefined;
  const details = LinkExpiredDetails.safeParse(apiError.details);
  return details.success ? details.data.email : undefined;
}
