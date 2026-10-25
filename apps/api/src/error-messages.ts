import type { BaseErrorCode, ErrorCode } from '@pokatim/contracts';
import { DomainError } from '@rkarakulov/api-kit/core';

/**
 * Тексты кодов ошибок проекта для фильтра ошибок базы (`API_ERROR_MESSAGES` в AppModule).
 * Коды базы фильтр озвучивает сам; новый код в контракте без записи здесь — ошибка typecheck.
 */
export const PROJECT_ERROR_MESSAGES = {
  EMAIL_TAKEN: 'E-mail уже зарегистрирован',
  EMAIL_UNAVAILABLE: 'E-mail недоступен для регистрации',
  LINK_EXPIRED: 'Ссылка устарела',
  INVALID_CREDENTIALS: 'Неверный e-mail или пароль',
} as const satisfies Record<Exclude<ErrorCode, BaseErrorCode>, string>;

/** Ожидаемый отказ бизнес-логики с кодом из контракта: опечатка в коде — ошибка компиляции. */
export const domainError = (code: ErrorCode, status: number, details?: unknown) =>
  new DomainError<ErrorCode>(code, status, details);
