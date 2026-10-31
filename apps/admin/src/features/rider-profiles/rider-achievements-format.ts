import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  AchievementInvalidStateDetails,
  type AchievementCode,
  type AchievementLevel,
  type RiderAchievementAdminItem,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { serverFieldErrors } from '../../field-errors';
import { formatDateTime } from '../../format';
import { httpStatus } from '../../session/errors';

const SHORT_ID = 6;

/** Хвост id объекта — как в подписи участника (`riderLabel`). */
export const shortObjectId = (id: string) => id.slice(-SHORT_ID);

/** «Гонщик · Бронза» / «Подиум». */
export const achievementName = (code: AchievementCode, level: AchievementLevel | null) =>
  level
    ? t('admin.riderAchievements.nameLevel', {
        name: t(`achievements.${code}.title`),
        level: t(`achievements.level.${level}`),
      })
    : t(`achievements.${code}.title`);

/** «Гонка · Минская сотка»; объекта нет (`title: null`) — «Объект недоступен ·<хвост id>». */
export const objectLabel = ({ kind, id, title }: RiderAchievementAdminItem['object']) =>
  title === null
    ? t('admin.riderAchievements.objectMissing', { id: shortObjectId(id) })
    : t('admin.riderAchievements.object', {
        kind: t(`admin.riderAchievements.kind.${kind}`),
        title,
      });

/** Ручное решение: «Ольга · 30.10.2026, 12:00» (Минск); нет — «—». */
export const decisionLabel = (override: RiderAchievementAdminItem['override']) =>
  override
    ? t('admin.riderAchievements.decision', {
        name: override.by.displayName,
        date: formatDateTime(override.at),
      })
    : t('admin.riderAchievements.none');

/** «По фактам» (RC-6): «Заработано · Серебро» / «Заработано» / «Не заработано» / «Неизвестно». */
export const byFactsLabel = ({ state, level }: RiderAchievementAdminItem['byFacts']) =>
  state === 'earned' && level
    ? t('admin.riderAchievements.byFacts.earnedLevel', { level: t(`achievements.level.${level}`) })
    : t(`admin.riderAchievements.byFacts.${state}`);

export const STATUS_TONE = {
  granted: 'success',
  granted_manually: 'ink',
  revoked: 'neutral',
  revoked_manually: 'error',
} as const satisfies Record<RiderAchievementAdminItem['status'], string>;

/** Выдача видима (RC-12): её можно отозвать вручную. */
export const isVisible = (item: RiderAchievementAdminItem) =>
  item.status === 'granted' || item.status === 'granted_manually';

/** 409 `ACHIEVEMENT_INVALID_STATE` — блок устарел, его надо перечитать. */
export const isInvalidState = (error: unknown) =>
  apiErrorOf(error)?.code === 'ACHIEVEMENT_INVALID_STATE';

/** Ошибка поля `objectId` из 400 — показывается под полем id объекта. */
export const hasObjectError = (error: unknown) =>
  serverFieldErrors(error)?.some((field) => field.path === 'objectId') ?? false;

/** Текст ошибки действия в окне причины: 409, 400 по полям, 404, 429, сеть. */
export function achievementActionErrorText(error: unknown): string {
  if (isNetworkError(error)) return t('error.network');
  const apiError = apiErrorOf(error);
  if (apiError?.code === 'ACHIEVEMENT_INVALID_STATE') {
    const details = AchievementInvalidStateDetails.safeParse(apiError.details);
    if (details.success) return t(`admin.riderAchievements.error.${details.data.reason}`);
  }
  if (apiError?.code === 'VALIDATION_FAILED') return t('admin.riderAchievements.error.fields');
  const status = httpStatus(error);
  if (status === 404) return t('admin.riderAchievements.error.notFound');
  if (status === 429) return t('admin.riderAchievements.error.rateLimited');
  return apiError ? t('admin.saveFailed') : t('error.unknown');
}
