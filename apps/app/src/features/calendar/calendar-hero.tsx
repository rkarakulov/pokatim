import type { CalendarStartCard } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { SectionHero } from '@/components/section-hero';

import { calendarMeta, calendarStatusLine, formatCalendarStartDate } from './format';

/**
 * Герой старта календаря (Главная и вкладка «Календарь»): кикер, дата крупно, название, мета, строка «До старта N
 * дней.» и «Регистрация у организатора.» — текстом (переход на регистрацию — на карточке). «Сейчас» — на клиенте:
 * экраны без SSR. С `onPress` — ссылка в карточку старта.
 */
export function CalendarStartHero({
  start,
  now,
  kicker = t('calendar.heroKicker'),
  onPress,
}: {
  start: CalendarStartCard;
  now: Date;
  kicker?: string;
  onPress?: () => void;
}) {
  return (
    <SectionHero
      kicker={kicker}
      date={formatCalendarStartDate(start, now)}
      title={start.title}
      meta={[
        calendarMeta(start),
        calendarStatusLine(start, now),
        start.registrationUrl ? t('calendar.registration') : null,
      ].filter((line): line is string => !!line)}
      {...(onPress ? { onPress } : {})}
    />
  );
}
