import type {
  PublicRiderProfile,
  RiderBestPlace,
  PublicRiderRace,
  RiderRaceHistoryItem,
  RiderRideHistoryItem,
  RiderStats,
} from '@pokatim/contracts';
import { i18n, t } from '@pokatim/i18n';
import type { PillTone } from '@rkarakulov/ui';

import type { StatItem } from '@/components/stat-block';
import { formatElapsed } from '@/features/races/format';
import {
  groupLabel,
  resultElapsed,
  resultPill,
  tierLabel,
} from '@/features/races/participation-format';
import { distanceText } from '@/features/rides/format';
import { placeView } from '@/features/standings/standings-format';
import { formatMinskDateTime, meta } from '@/lib/minsk-format';

/*
 * Профиль райдера (rider-profile) — чистые подписи. Суммы, места, статусы и роли — только с сервера (§4.1); здесь —
 * тексты. Даты истории — всегда с годом (`now = null`): история — прошлое, и SSR публичного профиля совпадает с
 * гидрацией. `'unknown'` (сервер новее) — без подписи.
 */

const number = (value: number) => i18n.formatNumber(value, { maximumFractionDigits: 1 });
const none = () => t('profile.stats.none');

/** Место «=6» / «6»; места нет — «—». */
const placeText = (place: number | null, tied: boolean) =>
  place === null ? { text: none(), a11y: none() } : placeView(place, tied);

/** Ячейки статистики своего профиля: заезды, км (одна десятая), набор, гонки в зачёте, подиумы, лучшее место. */
export function ownStatItems(stats: RiderStats): StatItem[] {
  const best = stats.bestPlaces[0];
  return [
    { value: number(stats.activities), label: t('profile.stats.activities') },
    {
      value: number(stats.distanceM / 1000),
      unit: t('profile.stats.km'),
      label: t('profile.stats.distance'),
    },
    {
      value: number(stats.elevationGainM),
      unit: t('profile.stats.m'),
      label: t('profile.stats.elevation'),
    },
    { value: number(stats.races), label: t('profile.stats.races') },
    { value: number(stats.podiums), label: t('profile.stats.podiums') },
    {
      value: best ? placeView(best.place, best.tied).text : none(),
      label: t('profile.stats.bestPlace'),
    },
  ];
}

/** Ячейки публичного профиля: без км, набора и заездов (их нет в ответе). */
export function publicStatItems(stats: PublicRiderProfile['stats']): StatItem[] {
  return [
    { value: number(stats.races), label: t('profile.stats.races') },
    { value: number(stats.podiums), label: t('profile.stats.podiums') },
    {
      value: stats.bestPlace === null ? none() : placeView(stats.bestPlace, false).text,
      label: t('profile.stats.bestPlace'),
    },
  ];
}

/** Строка «Гонки» истории (своей и публичной) — общий вид `RaceHistoryRow`. */
export interface RaceRowView {
  raceId: string;
  place: string;
  title: string;
  date: string;
  /** уровень и группа (свой профиль) или группа (публичный); пусто — без строки */
  details: string;
  pill: { label: string; tone: PillTone } | null;
  time: string | null;
  a11y: string;
}

const historyDate = (iso: string) => formatMinskDateTime(iso, null).date;
const groupText = (key: RiderRaceHistoryItem['groupKey']) =>
  key === 'unknown' ? null : groupLabel(key);

function raceA11y(view: Omit<RaceRowView, 'a11y' | 'raceId'>, placeA11y: string): string {
  return [
    view.title,
    view.date,
    t('profile.history.place', { place: placeA11y }),
    view.pill?.label ?? null,
    view.time === null ? null : t('profile.history.time', { time: view.time }),
  ]
    .filter((part): part is string => part !== null)
    .reduce((head, next) => t('format.listComma', { head, next }));
}

/** Своя гонка: место и статус — как «моё участие» гонки; уровень и группа — во второй строке. */
export function ownRaceRow(item: RiderRaceHistoryItem): RaceRowView {
  const place = placeText(item.result.place, item.result.tied);
  const view = {
    place: place.text,
    title: item.race.title,
    date: historyDate(item.race.windowStartsAt),
    details: meta([
      item.tier === 'unknown' ? null : tierLabel(item.tier),
      groupText(item.groupKey),
    ]),
    pill: resultPill(item.result.status),
    // правило «время только у статусов с сегментом» — общее с «моим участием»; `ranked`/`group` ему не нужны
    time: resultElapsed({ ...item.result, ranked: 0, group: item.groupKey }),
  };
  return { raceId: item.race.id, ...view, a11y: raceA11y(view, place.a11y) };
}

/** Публичная гонка: только опубликованные протоколы (`final | revised | dq`), без уровня. */
export function publicRaceRow(item: PublicRiderRace): RaceRowView {
  const place = placeText(item.place, item.tied);
  const view = {
    place: place.text,
    title: item.race.title,
    date: historyDate(item.race.windowStartsAt),
    details: meta([groupText(item.groupKey)]),
    pill: item.status === 'unknown' ? null : resultPill(item.status),
    time: formatElapsed(item.elapsedSec),
  };
  return { raceId: item.race.id, ...view, a11y: raceA11y(view, place.a11y) };
}

/** «Лучшие места» под статистикой: место, гонка, дата, группа — без плашки и времени. */
export function bestPlaceRow(item: RiderBestPlace): RaceRowView {
  const place = placeView(item.place, item.tied);
  const view = {
    place: place.text,
    title: item.race.title,
    date: historyDate(item.race.windowStartsAt),
    details: meta([groupText(item.groupKey)]),
    pill: null,
    time: null,
  };
  return { raceId: item.race.id, ...view, a11y: raceA11y(view, place.a11y) };
}

/** Строка «Райды»: название, дата и время старта, плановая дистанция, роль. */
export function rideRow(item: RiderRideHistoryItem) {
  const role = item.role === 'unknown' ? null : t(`profile.history.role.${item.role}`);
  const when = formatMinskDateTime(item.startsAt, null).full;
  const details = meta([when, distanceText(item.distanceKm), role]);
  return { rideId: item.id, title: item.title, details, a11y: meta([item.title, details]) };
}
