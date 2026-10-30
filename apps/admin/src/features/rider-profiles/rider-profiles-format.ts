import { isNetworkError, apiErrorOf } from '@pokatim/api-client';
import {
  PROFILE_REPORT_REASONS,
  type ProfileReportReason,
  type RiderProfileModerationRow,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

/** Вкладки очереди — 1:1 с действиями сброса (RC-F2); прочие причины видны во «Все» по `openReasons`. */
export const RIDER_PROFILE_QUEUE_REASONS = [
  'name',
  'photo',
  'club',
] as const satisfies readonly ProfileReportReason[];
export type RiderProfileQueueReason = (typeof RIDER_PROFILE_QUEUE_REASONS)[number];

/**
 * Фильтр очереди из URL (`?reason=name|photo|club`); прочее — «Все». Ключ возвращается всегда (`undefined`): роутер
 * сливает сырой поиск с проверенным, и без ключа `?reason=spam` дошёл бы до экрана.
 */
export interface RiderProfilesSearch {
  reason?: RiderProfileQueueReason | undefined;
}

export function validateRiderProfilesSearch(search: Record<string, unknown>): RiderProfilesSearch {
  const reason = search.reason as RiderProfileQueueReason;
  return { reason: RIDER_PROFILE_QUEUE_REASONS.includes(reason) ? reason : undefined };
}

/** Причины открытых жалоб строки — в порядке справочника (сервер уже упорядочил; повторно — на случай старого API). */
export const openReasonsLabel = (reasons: readonly ProfileReportReason[]) =>
  t('admin.riderProfiles.openReasons', {
    reasons: PROFILE_REPORT_REASONS.filter((reason) => reasons.includes(reason))
      .map((reason) => t(`domain.profileReportReason.${reason}`))
      .join(', '),
  });

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
