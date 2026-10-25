import type { RaceCard } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { Banner, SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  cancelMessage,
  formatRaceWindow,
  raceCardLine,
  raceClassSurfaces,
} from '@/features/races/format';
import { formatDistances, heroDateText } from '@/lib/minsk-format';

export interface RaceListCardProps {
  race: RaceCard;
  /** «Сейчас» для строки окна; `null` — SSR и первый рендер публичного экрана (без «сегодня / завтра»). */
  now: Date | null;
  /** Публичный экран: даты всегда с годом (не зависят от «сейчас», совпадают с HTML сервера). */
  datesWithYear?: boolean;
  onPress: () => void;
}

/**
 * Карточка гонки в списке (`.race-card` прототипа; имя без коллизии с типом `RaceCard`): даты окна и км, название,
 * класс и покрытия, строка окна по фазе сервера; отменённая — нейтральный баннер с причиной вместо строки. Плашек
 * участия и результатов нет (§4). Для скринридера — одна ссылка «название. даты. строка окна».
 */
export function RaceListCard({ race, now, datesWithYear = false, onPress }: RaceListCardProps) {
  const theme = useTheme();
  const dates = formatRaceWindow(
    race.windowStartsAt,
    race.windowEndsAt,
    datesWithYear ? null : now,
  );
  const line = raceCardLine(race, now);
  const cancelled = race.phase === 'cancelled' ? cancelMessage(race.cancelReason) : null;
  const classSurfaces = raceClassSurfaces(race);
  const label = [race.title, heroDateText(dates), cancelled ?? line]
    .filter((part): part is string => !!part)
    .join('. ');

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.card, { borderTopColor: theme.border.subtle }]}
    >
      <View style={styles.top}>
        <View style={styles.dates}>
          <Text style={[textStyle('displayXs'), { color: theme.text.primary }]}>{dates.value}</Text>
          {dates.unit ? (
            <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{dates.unit}</Text>
          ) : null}
        </View>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {formatDistances([race.distanceKm])}
        </Text>
      </View>
      <Text style={[textStyle('displaySm'), styles.title, { color: theme.text.primary }]}>
        {race.title}
      </Text>
      {classSurfaces ? (
        <Text style={[textStyle('meta'), styles.meta, { color: theme.text.secondary }]}>
          {classSurfaces}
        </Text>
      ) : null}
      {cancelled ? (
        <View style={styles.line}>
          <Banner tone="info" message={cancelled} />
        </View>
      ) : line ? (
        <Text style={[textStyle('titleSm'), styles.line, { color: theme.text.primary }]}>
          {line}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Скелетон карточки списка (первая загрузка, догрузка страницы): даты, название, мета — раскладка карточки. */
export function RaceListCardSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.card, styles.skeleton, { borderTopColor: theme.border.subtle }]}>
      <SkeletonText variant="displayXs" lines={1} lastLineWidth="30%" />
      <SkeletonText variant="displaySm" lines={1} lastLineWidth="80%" />
      <SkeletonText variant="meta" lines={2} lastLineWidth="60%" />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: space.s2 },
  card: { borderTopWidth: stroke.hairline, paddingVertical: space.s4 },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.s3,
  },
  dates: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.s1 },
  title: { marginTop: space.s1 },
  meta: { marginTop: space.s1 },
  line: { marginTop: space.s2 },
});
