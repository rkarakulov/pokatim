import type { RideCard, RideDetail, RideViewer } from '@pokatim/contracts';
import { i18n, t } from '@pokatim/i18n';

import { domainLabel, formatMinskDateTime, meta } from '@/lib/minsk-format';

/**
 * Подписи кофе-райда (вкладка, герой, Главная, карточка, OG) — чистые функции. Время — `formatMinskDateTime`
 * (Минск, не пояс устройства); `now = null` — дата всегда с годом (публичный экран, SSR). Фаза, роль, «полон» —
 * только с сервера; `'unknown'` — нейтрально (без подписи).
 */

type RideSummary = Pick<
  RideCard,
  | 'title'
  | 'startsAt'
  | 'city'
  | 'place'
  | 'distanceKm'
  | 'paceMinKmh'
  | 'paceMaxKmh'
  | 'limit'
  | 'goingCount'
  | 'phase'
>;

const number = (value: number) => i18n.formatNumber(value, { maximumFractionDigits: 1 });

/** Город по справочнику; незнакомый код (`'unknown'`) — `null`. */
export const cityLabel = (city: string) => domainLabel('domain.city', city);

/** Диапазон темпа без единиц: «22–24» (тире без пробелов), равные — «25». */
export const paceRange = (min: number, max: number) =>
  min === max ? number(min) : t('format.range', { from: number(min), to: number(max) });

/** Темп: «22–24 км/ч», равные — «25 км/ч». */
export const paceText = (min: number, max: number) =>
  t('format.paceKmh', { pace: paceRange(min, max) });

export const distanceText = (km: number) => t('format.distanceKm', { distance: number(km) });

/** Место с городом: «Минск, Парк Победы»; незнакомый город — только место. */
export function cityPlace(ride: Pick<RideSummary, 'city' | 'place'>): string {
  const city = cityLabel(ride.city);
  return city ? t('rides.cityPlace', { city, place: ride.place }) : ride.place;
}

/** Мета героя: «104 км · темп 25–27 км/ч · Минск, Парк Победы». */
export const rideHeroMeta = (ride: RideSummary) =>
  meta([
    distanceText(ride.distanceKm),
    t('rides.pace', { pace: paceText(ride.paceMinKmh, ride.paceMaxKmh) }),
    cityPlace(ride),
  ]);

/** Мета строки ленты: «42 км · темп 22–24 км/ч · старт: Парк Победы». */
export const rideRowMeta = (ride: RideSummary) =>
  meta([
    distanceText(ride.distanceKm),
    t('rides.pace', { pace: paceText(ride.paceMinKmh, ride.paceMaxKmh) }),
    t('rides.startPlace', { place: ride.place }),
  ]);

/** Верх строки ленты: «10:00 · Минск». */
export const rideRowTime = (ride: Pick<RideSummary, 'startsAt' | 'city'>, now: Date | null) =>
  meta([formatMinskDateTime(ride.startsAt, now).time, cityLabel(ride.city)]);

/** Дата героя: «Сб 3 октября, 9:00» (год — если не текущий). */
export const rideHeroDate = (startsAt: string, now: Date | null) =>
  formatMinskDateTime(startsAt, now, 'short').full;

/** Подпись дня ленты: «Воскресенье, 4 октября» (год — если не текущий). */
export const rideDayLabel = (startsAt: string, now: Date | null) =>
  formatMinskDateTime(startsAt, now).date;

/** Роль зрителя «в списке»: организатор или участник. */
const listed = (viewer: Pick<RideViewer, 'role'> | null | undefined) =>
  viewer?.role === 'organizer' || viewer?.role === 'participant';

/**
 * Подпись стопки: «идут 5 из 12», «идут 7» (без лимита), прошедший — «записались 9» (Q2 «Свои» P2: «ехали» — только подтвердившие явку); зритель в списке — «· вы» (один
 * идущий — он сам) или «· вы в списке».
 */
export function goingCaption(
  ride: Pick<RideSummary, 'goingCount' | 'limit' | 'phase'>,
  viewer?: Pick<RideViewer, 'role'> | null,
): string {
  const count = ride.goingCount;
  const caption =
    ride.phase === 'past'
      ? t('rides.going.pastJoined', { count })
      : ride.limit === null
        ? t('rides.going.open', { count })
        : t('rides.going.limited', { count, limit: ride.limit });
  if (!listed(viewer)) return caption;
  return count <= 1 ? t('rides.going.you', { caption }) : t('rides.going.youListed', { caption });
}

/**
 * Подпись организатора в кикере героя: «Организатор: Катя Л.»; без имени — строки нет (B9 смоука dev: одинокое
 * «ОРГАНИЗАТОР» читалось как пустое поле).
 */
export const organizerLine = (organizerName: string | null) =>
  organizerName ? t('rides.detail.organizer', { name: organizerName }) : null;

/** Текст сообщения «Поделиться»: «{название} — {дата}, {время}, {город}». */
export function rideShareText(ride: Pick<RideDetail, 'title' | 'startsAt' | 'city'>): string {
  const { date, time } = formatMinskDateTime(ride.startsAt, null);
  return t('rides.shareText', {
    title: ride.title,
    date,
    time,
    city: cityLabel(ride.city) ?? '',
  }).replace(/, $/, '');
}

/** OG / description: «Воскресенье, 4 октября 2026, 10:00 · Минск · 42 км · темп 22–24 км/ч» — без описания и ПДн. */
export const rideShareDescription = (ride: RideSummary) =>
  meta([
    formatMinskDateTime(ride.startsAt, null).full,
    cityLabel(ride.city),
    distanceText(ride.distanceKm),
    t('rides.pace', { pace: paceText(ride.paceMinKmh, ride.paceMaxKmh) }),
  ]);
