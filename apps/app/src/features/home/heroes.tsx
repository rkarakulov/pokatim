import type { CalendarStartCard, RaceCard } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { SectionHero } from '@/components/section-hero';

import { formatRaceWindow, raceHeroLine, raceMeta } from '@/features/races/format';

import { calendarMeta, calendarStatusLine, formatCalendarStartDate } from './format';

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

/** «Регистрация у организатора» — только текстом, без перехода (Q6). */
export function CalendarStartHero({ start, now }: { start: CalendarStartCard; now: Date }) {
  return (
    <SectionHero
      kicker={t('home.calendar.heroKicker')}
      date={formatCalendarStartDate(start, now)}
      title={start.title}
      meta={present([
        calendarMeta(start),
        calendarStatusLine(start, now),
        start.registrationUrl ? t('home.calendar.registration') : null,
      ])}
    />
  );
}
