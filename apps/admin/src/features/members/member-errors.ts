import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { type MessageKey, t } from '@pokatim/i18n';

import { isForbidden } from '../../session/errors';

const MEMBER_ERROR_KEYS: Partial<Record<string, MessageKey>> = {
  NOT_FOUND: 'admin.members.error.NOT_FOUND',
  PANEL_USER_UNVERIFIED: 'admin.members.error.PANEL_USER_UNVERIFIED',
  PANEL_ALREADY_MEMBER: 'admin.members.error.PANEL_ALREADY_MEMBER',
  PANEL_LAST_ADMIN: 'admin.members.error.PANEL_LAST_ADMIN',
  PANEL_SELF_ACTION: 'admin.members.error.PANEL_SELF_ACTION',
};

/** Коды выдачи роли, которые относятся к полю e-mail (ошибка — под полем). */
export const EMAIL_FIELD_CODES = new Set([
  'NOT_FOUND',
  'PANEL_USER_UNVERIFIED',
  'PANEL_ALREADY_MEMBER',
]);

/** Текст ошибки действия над сотрудником. */
export function memberErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('error.network');
  if (isForbidden(error)) return t('admin.error.forbidden');
  const key = MEMBER_ERROR_KEYS[apiErrorOf(error)?.code ?? ''];
  return key ? t(key) : t('error.unknown');
}
