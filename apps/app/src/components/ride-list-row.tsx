import type { RideCard } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { goingCaption, rideRowMeta, rideRowTime } from '@/features/rides/format';

import { GoingStack } from './going-stack';

export interface RideListRowProps {
  ride: RideCard;
  /** «Сейчас» — для года в подписях (вкладка без SSR). */
  now: Date;
  onPress: () => void;
  /** Действие справа — `RideGoingAction` строки. */
  action?: ReactNode;
  /** «в 12 км от вас» (05c, «Рядом» и точный старт); нет — без строки */
  distance?: string | null;
}

/**
 * Строка райда в ленте: «10:00 · Минск», название, мета «42 км · темп 22–24 км/ч · старт: …», «в 12 км от вас» (05c),
 * стопка «идут 5 из 12»
 * (пустые квадраты по числу — без имён и фото, Q4); действие участия — справа, вне ссылки. Hairline сверху,
 * `minHeight: size.rowMin`. Для скринридера — ссылка «название. время. мета. стопка».
 */
export function RideListRow({ ride, now, onPress, action, distance = null }: RideListRowProps) {
  const theme = useTheme();
  const time = rideRowTime(ride, now);
  const details = rideRowMeta(ride);
  const caption = goingCaption(ride, ride.viewer);

  return (
    <View testID="ride-row" style={[styles.row, { borderTopColor: theme.border.subtle }]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={[ride.title, time, details, distance, caption]
          .filter(Boolean)
          .join('. ')}
        onPress={onPress}
        style={styles.main}
      >
        <Text style={[textStyle('label'), { color: theme.text.secondary }]}>{time}</Text>
        <Text style={[textStyle('titleSm'), styles.title, { color: theme.text.primary }]}>
          {ride.title}
        </Text>
        <Text style={[textStyle('meta'), styles.meta, { color: theme.text.secondary }]}>
          {details}
        </Text>
        {distance ? (
          <Text style={[textStyle('meta'), styles.meta, { color: theme.text.secondary }]}>
            {distance}
          </Text>
        ) : null}
        <View style={styles.stack}>
          <GoingStack count={ride.goingCount} caption={caption} />
        </View>
      </Pressable>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

/** Скелетон строки (первая загрузка, догрузка). */
export function RideListRowSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: theme.border.subtle }]}>
      <View style={styles.main}>
        <SkeletonText variant="label" lines={1} lastLineWidth="30%" />
        <SkeletonText variant="titleSm" lines={1} lastLineWidth="80%" />
        <SkeletonText variant="meta" lines={2} lastLineWidth="50%" />
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
  main: { flex: 1, minWidth: 0 },
  title: { marginTop: space.s1 },
  meta: { marginTop: space.s1 },
  stack: { marginTop: space.s2 },
  action: { flexShrink: 0, alignItems: 'flex-end' },
});
