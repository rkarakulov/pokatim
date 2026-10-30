import { i18n, type MessageKey, minskDateTime, t } from '@pokatim/i18n';

import type { RideInviteInput } from './ride-invite.inputs';
import type { CardStat } from './story-card.render';

/** Цифра пары с единицей и подписью: «42» «км» «Дистанция». */
export type RideInviteStat = CardStat;

/** Тексты приглашения (регистр — `uppercase` токенов `storyCard.text`, не строки словаря). */
export interface RideInviteTexts {
  kicker: string;
  title: string;
  date: string;
  time: string;
  start: string;
  distance: RideInviteStat;
  pace: RideInviteStat;
  brand: string;
}

const number = (value: number) => i18n.formatNumber(value, { maximumFractionDigits: 1 });
const weekdayOf = (localDate: string) => new Date(`${localDate}T00:00:00Z`).getUTCDay();
/** «9:00» — часы без ведущего нуля (как подписи райдов приложения). */
const shortTime = (time: string) => time.replace(/^0(\d)/, '$1');

/**
 * Тексты из фактов — общими форматтерами `@pokatim/i18n`, время — по Минску: дата «4 октября» без года (райд будущий,
 * `now` — сам старт), «Воскресенье, 10:00», «Старт: <место>», пара «дистанция · темп» (тире диапазона без пробелов).
 * Организатора, участников и мест на карточке нет (Q7).
 */
export function rideInviteTexts(input: RideInviteInput): RideInviteTexts {
  const { facts } = input;
  const { localDate, date, time } = minskDateTime(facts.startsAt.toISOString(), facts.startsAt);
  const pace =
    facts.paceMinKmh === facts.paceMaxKmh
      ? number(facts.paceMinKmh)
      : t('format.range', { from: number(facts.paceMinKmh), to: number(facts.paceMaxKmh) });
  return {
    kicker: t('rideInvite.kicker'),
    title: facts.title,
    date,
    time: t('format.dateTime', {
      date: t(`date.weekday.${weekdayOf(localDate)}` as MessageKey),
      time: shortTime(time),
    }),
    start: t('rideInvite.start', { place: facts.place }),
    distance: {
      value: number(facts.distanceKm),
      unit: t('rideInvite.unitKm'),
      label: t('rideInvite.distance'),
    },
    pace: { value: pace, unit: t('rideInvite.unitKmh'), label: t('rideInvite.pace') },
    brand: t('storyCard.brand'),
  };
}
