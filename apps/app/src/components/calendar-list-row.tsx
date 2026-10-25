import type { CalendarStartCard } from '@pokatim/contracts';
import { inset, size, space, stroke } from '@pokatim/design-tokens';
import { SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { calendarMeta, formatCalendarStartDate } from '@/features/calendar/format';
import { heroDateText } from '@/lib/minsk-format';

export interface CalendarListRowProps {
  start: CalendarStartCard;
  /** «Сейчас» — для года в дате (вкладка без SSR). */
  now: Date;
  onPress: () => void;
}

/**
 * Строка старта в списке (`.lrow` прототипа): рамка даты (день или «26–27» + месяц), название, мета; hairline сверху,
 * без коробок. Шеврона нет — иконок в системе нет (§5.1). Ширина рамки — `size.rowMin` (прототип 62 px, токена
 * нет, Q16). Для скринридера — одна ссылка «название. дата. мета».
 */
export function CalendarListRow({ start, now, onPress }: CalendarListRowProps) {
  const theme = useTheme();
  const date = formatCalendarStartDate(start, now);
  const metaLine = calendarMeta(start);
  const label = [start.title, heroDateText(date), metaLine].filter(Boolean).join('. ');

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, { borderTopColor: theme.border.subtle }]}
    >
      <View style={[styles.frame, { borderColor: theme.border.subtle }]}>
        <Text style={[textStyle('displayXs'), styles.center, { color: theme.text.primary }]}>
          {date.value}
        </Text>
        {date.unit ? (
          <Text style={[textStyle('metaXs'), styles.center, { color: theme.text.secondary }]}>
            {date.unit}
          </Text>
        ) : null}
      </View>
      <View style={styles.main}>
        <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{start.title}</Text>
        {metaLine ? (
          <Text style={[textStyle('meta'), styles.meta, { color: theme.text.secondary }]}>
            {metaLine}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Скелетон строки (первая загрузка, догрузка): рамка даты и две строки текста. */
export function CalendarListRowSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: theme.border.subtle }]}>
      <View style={[styles.frame, { borderColor: theme.border.subtle }]}>
        <SkeletonText variant="displayXs" lines={1} />
      </View>
      <View style={styles.main}>
        <SkeletonText variant="titleSm" lines={1} lastLineWidth="80%" />
        <SkeletonText variant="meta" lines={1} lastLineWidth="60%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    minHeight: size.rowMin,
    paddingVertical: space.s4,
    borderTopWidth: stroke.hairline,
  },
  frame: {
    width: size.rowMin,
    borderWidth: stroke.hairline,
    paddingVertical: space.s2,
    paddingHorizontal: inset.xs,
    alignItems: 'center',
  },
  center: { textAlign: 'center' },
  main: { flex: 1, minWidth: 0 },
  meta: { marginTop: space.s1 },
});
