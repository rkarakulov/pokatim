import type { RiderTogether, SocialConnectionRow } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { minskDateTime } from '@/lib/minsk-format';

/**
 * Тексты «Свои» по полям сервера (K6, RC-P3-5) — чистые функции. Дата — по Минску, год — если не текущий (`now`;
 * `null` — год всегда).
 */

/** «Вместе ехали 3 раза · последний — 10 октября» на чужом профиле; не ехали — `null` (строки нет). */
export function togetherText(together: RiderTogether, now: Date | null): string | null {
  if (together.rideCount <= 0 || together.lastRideAt === null) return null;
  return t('social.together', {
    count: together.rideCount,
    date: minskDateTime(together.lastRideAt, now).date,
  });
}

/**
 * Подпись строки «Свои»: совместные райды → «Вместе N раз · последний — дата», иначе ручная → «Добавлены вами», иначе
 * приглашение → «По приглашению»; незнакомый источник — без подписи.
 */
export function connectionRowText(
  row: Pick<SocialConnectionRow, 'rideCount' | 'lastRideAt' | 'sources'>,
  now: Date | null,
): string | null {
  if (row.rideCount > 0 && row.lastRideAt !== null) {
    return t('social.row.together', {
      count: row.rideCount,
      date: minskDateTime(row.lastRideAt, now).date,
    });
  }
  if (row.sources.includes('manual')) return t('social.row.manual');
  if (row.sources.includes('invite')) return t('social.row.invite');
  return null;
}
