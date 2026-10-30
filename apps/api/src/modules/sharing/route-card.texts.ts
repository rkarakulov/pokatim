import { i18n, type MessageKey, t } from '@pokatim/i18n';

import type { RouteCardInput } from './route-card.inputs';
import type { CardStat } from './story-card.render';

/** Тексты карточки маршрута (регистр — `uppercase` токенов `storyCard.text`, не строки словаря). */
export interface RouteCardTexts {
  kicker: string;
  title: string;
  /** «Минск · Круговой» */
  place: string;
  /** «Дистанция» и «Набор»; набора нет — одна цифра */
  stats: CardStat[];
  brand: string;
}

/**
 * Тексты из фактов каталога — общими форматтерами `@pokatim/i18n`: город и форма (как чипы карточки маршрута),
 * дистанция в км с дробью, набор в целых метрах. Автора, покрытий, «В пути» и дат на карточке нет (R3).
 */
export function routeCardTexts(input: RouteCardInput): RouteCardTexts {
  const { facts } = input;
  const stats: CardStat[] = [
    {
      value: i18n.formatNumber(facts.distanceM / 1000, { maximumFractionDigits: 1 }),
      unit: t('routeCard.unitKm'),
      label: t('routeCard.distance'),
    },
  ];
  if (facts.elevationGainM !== null) {
    stats.push({
      value: i18n.formatNumber(Math.round(facts.elevationGainM)),
      unit: t('routeCard.unitM'),
      label: t('routeCard.gain'),
    });
  }
  return {
    kicker: t('routeCard.kicker'),
    title: facts.title,
    place: t('routeCard.place', {
      city: t(`domain.city.${facts.city}` as MessageKey),
      shape: t(facts.isLoop ? 'routeCard.loop' : 'routeCard.oneWay'),
    }),
    stats,
    brand: t('storyCard.brand'),
  };
}
