import { defineErrorCodes, defineFieldErrorCodes } from '@rkarakulov/contracts-core';
import type { z } from 'zod';

/** Версия публичного API: установленные приложения живут на старых версиях, ломать нельзя. */
export const API_VERSION = 'v1' as const;

export { PageQuery, RateLimitedDetails, Uuid } from '@rkarakulov/contracts-core';

/** Коды базы: их тексты и обработку даёт инфраструктура базы (фильтр ошибок api-kit, клиент). */
export { BASE_ERROR_CODES, type BaseErrorCode } from '@rkarakulov/contracts-core';

/**
 * Коды ошибок API: коды базы + коды проекта. Порядок — база первой, свои — только в конец списка
 * (установленные клиенты знают прежний состав). Тексты своих кодов — apps/api/src/error-messages.ts.
 */
export const { ErrorCode, ApiError } = defineErrorCodes([
  // регистрация pokatim
  'EMAIL_TAKEN',
  'EMAIL_UNAVAILABLE',
  'LINK_EXPIRED',
  // вход по паролю (слайс 2): неверный пароль, неизвестный и удалённый адрес — один код
  'INVALID_CREDENTIALS',
  // панель «Протокол» (admin-01): верный пароль без роли; выдача роли неподтверждённому, повторная выдача;
  // последний активный администратор; действие над собой
  'PANEL_ACCESS_DENIED',
  'PANEL_USER_UNVERIFIED',
  'PANEL_ALREADY_MEMBER',
  'PANEL_LAST_ADMIN',
  'PANEL_SELF_ACTION',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
export type ApiError = z.infer<typeof ApiError>;

/**
 * Коды ошибок полей: коды базы (`REQUIRED`, `INVALID`, …) + коды проекта. Сообщение zod-схемы = код,
 * текст для человека выбирает клиент (i18n). `fieldError` — с кодами проекта, не базовый.
 */
export const { FieldErrorCode, ValidationErrorDetails, fieldError } = defineFieldErrorCodes([
  'AGE_BELOW_18',
  'CONSENT_REQUIRED',
]);
export type FieldErrorCode = z.infer<typeof FieldErrorCode>;
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetails>;
