import {
  formatDistances,
  formatKm,
  formatLocalRange,
  heroDateText,
  type MessageKey,
  minskDateTime,
  t,
} from '@pokatim/i18n';

import type { OgCardInput } from './og-card.inputs';

/** Тексты OG-картинки объекта: метка вида, название, 1–2 строки фактов, бренд. */
export interface OgCardTexts {
  kicker: string;
  title: string;
  facts: string[];
  brand: string;
}

/** Тексты бренд-картинки: название, слоган, бренд. */
export interface OgBrandTexts {
  title: string;
  tagline: string;
  brand: string;
}

type OgObjectInput = Exclude<OgCardInput, { kind: 'brand' }>;

/** Склейка элементов строки фактов через « · »; пустые — пропускаются. */
const join = (items: readonly (string | null)[]) =>
  items
    .filter((item): item is string => item !== null && item !== '')
    .reduce((head, next) => t('ogCard.facts', { head, next }));

const km = (value: number) => t('format.distanceKm', { distance: formatKm(value) });
const weekdayOf = (localDate: string) => new Date(`${localDate}T00:00:00Z`).getUTCDay();
/** «9:00» — часы без ведущего нуля (как подписи райдов). */
const shortTime = (time: string) => time.replace(/^0(\d)/, '$1');
/** Даты Минска одной строкой, всегда с годом (картинка живёт долго): «24–26 октября 2026». */
const localRange = (from: string, to: string) => heroDateText(formatLocalRange(from, to, null));

function factsOf(input: OgObjectInput): string[] {
  switch (input.kind) {
    case 'race': {
      const f = input.facts;
      const from = minskDateTime(f.windowStartsAt.toISOString(), null).localDate;
      const to = minskDateTime(f.windowEndsAt.toISOString(), null).localDate;
      return [
        localRange(from, to),
        join([km(f.distanceKm), t(`domain.bikeClass.${f.bikeClass}` as MessageKey)]),
      ];
    }
    case 'ride': {
      const f = input.facts;
      const { localDate, date, time } = minskDateTime(f.startsAt.toISOString(), null);
      const day = t('format.weekdayLong', {
        weekday: t(`date.weekday.${weekdayOf(localDate)}` as MessageKey),
        date,
      });
      const pace =
        f.paceMinKmh === f.paceMaxKmh
          ? formatKm(f.paceMinKmh)
          : t('format.range', { from: formatKm(f.paceMinKmh), to: formatKm(f.paceMaxKmh) });
      return [
        t('format.dateTime', { date: day, time: shortTime(time) }),
        join([
          km(f.distanceKm),
          t('ogCard.pace', { range: pace }),
          t('rideInvite.start', { place: f.place }),
        ]),
      ];
    }
    case 'route': {
      const f = input.facts;
      return [
        join([
          km(f.distanceM / 1000),
          f.elevationGainM === null
            ? null
            : t('ogCard.elevation', { value: Math.round(f.elevationGainM) }),
        ]),
        join([t(`domain.city.${f.city}` as MessageKey), f.isLoop ? t('ogCard.loop') : null]),
      ];
    }
    case 'calendar': {
      const f = input.facts;
      return [
        localRange(f.startsOn, f.endsOn ?? f.startsOn),
        join([f.city, formatDistances(f.distancesKm)]),
      ];
    }
  }
}

/**
 * Тексты OG-картинки — общими форматтерами `@pokatim/i18n`, время — по Минску. Только поля фактов: организатора,
 * автора, участников и описания в типах фактов нет (D7). Регистр метки и бренда — `uppercase` токенов `ogCard.text`.
 */
export function ogCardTexts(input: OgObjectInput): OgCardTexts {
  return {
    kicker: t(`ogCard.kicker.${input.kind}`),
    title: input.facts.title,
    facts: factsOf(input).filter((line) => line !== ''),
    brand: t('storyCard.brand'),
  };
}

export function ogBrandTexts(): OgBrandTexts {
  return { title: t('app.name'), tagline: t('app.tagline'), brand: t('storyCard.brand') };
}

/** Alt картинки для SSR и превью: «Гонка «…»», бренд — «Покатим — слоган». */
export function ogCardAlt(input: OgCardInput): string {
  return input.kind === 'brand'
    ? t('ogCard.alt.brand', { tagline: t('app.tagline') })
    : t(`ogCard.alt.${input.kind}`, { title: input.facts.title });
}
