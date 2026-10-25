import type { FieldErrorCode } from '@pokatim/contracts';

import { domainError } from '../../error-messages';
import type { FieldIssue } from './races.policy';

/** Нарушение правила сервера — `400 VALIDATION_FAILED` с кодами под полями формы. */
export function fieldsError(issues: readonly FieldIssue[]) {
  return domainError('VALIDATION_FAILED', 400, { fields: issues });
}

export const fieldError = (path: string, code: FieldErrorCode) => fieldsError([{ path, code }]);

/** Ожидаемая `version` устарела (R3): «Запись изменили — обновите страницу». */
export const staleVersion = () => domainError('CONFLICT', 409);
