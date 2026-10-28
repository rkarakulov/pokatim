import { isNetworkError, apiErrorOf } from '@pokatim/api-client';
import type { RiderProfileModerationRow } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

/** Что есть в профиле: «Фото, клуб» / «Фото» / «Клуб» / «—». */
export function profileContentLabel({
  hasAvatar,
  hasClub,
}: Pick<RiderProfileModerationRow, 'hasAvatar' | 'hasClub'>): string {
  if (hasAvatar && hasClub) return t('admin.riderProfiles.content.both');
  if (hasAvatar) return t('admin.riderProfiles.content.avatar');
  if (hasClub) return t('admin.riderProfiles.content.club');
  return t('admin.riderProfiles.none');
}

/** Ошибка действия в окне причины (409 `CONFLICT` — не здесь: баннер на карточке). */
export const actionErrorText = (error: unknown) => {
  if (isNetworkError(error)) return t('error.network');
  return apiErrorOf(error) ? t('admin.saveFailed') : t('error.unknown');
};
