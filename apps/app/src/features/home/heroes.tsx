import type { CatalogRouteCard, RaceCard } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { SectionHero } from '@/components/section-hero';

import { formatRaceWindow, raceHeroLine, raceMeta } from '@/features/races/format';
import { routeHeroDate, routePlace, routeStats } from '@/features/routes/format';

const present = (lines: (string | null)[]) => lines.filter((line): line is string => !!line);

/**
 * Герои разделов Главной. «Сейчас» — на клиенте: Главная без SSR-данных (R6), подписи «сегодня / через N дней»
 * рендерятся только после монтирования.
 */
export function RaceHero({
  race,
  now,
  onPress,
}: {
  race: RaceCard;
  now: Date;
  /** Герой ведёт в карточку гонки (Q12 блока 03). */
  onPress: () => void;
}) {
  return (
    <SectionHero
      kicker={t('home.races.heroKicker')}
      date={formatRaceWindow(race.windowStartsAt, race.windowEndsAt, now)}
      title={race.title}
      meta={present([raceMeta(race), raceHeroLine(race, now)])}
      onPress={onPress}
    />
  );
}

/**
 * Герой раздела «Маршруты» (routes-01, RC-8): текстовый — длина крупно, название, «набор · петля» и «город ·
 * покрытие»; линии маршрута на Главной нет (без запроса карты и второго рендера). Ведёт в карточку маршрута.
 */
export function RouteHero({ route, onPress }: { route: CatalogRouteCard; onPress: () => void }) {
  return (
    <SectionHero
      kicker={t('home.routes.heroKicker')}
      date={routeHeroDate(route)}
      title={route.title}
      meta={present([routeStats(route), routePlace(route)])}
      onPress={onPress}
    />
  );
}
