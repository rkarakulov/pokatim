import type { RideMapPoint } from '@pokatim/contracts';
import { motion, size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle } from '@rkarakulov/ui';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { meta } from '@/lib/minsk-format';

import { goingCaption, rideHeroDate } from './format';

/**
 * Карточка выбранной точки карты ленты (05c, RC-11) — поверх нижнего края карты (`surface.raised`): райды группы
 * (одна точка старта — несколько райдов популярного маршрута), каждый — ссылка на карточку райда: название, дата,
 * «идут N из M». «Закрыть» снимает выбор. Путь без карты для скринридера и клавиатуры — режим «Список». Группа до
 * 200 райдов и крупный шрифт: карточка не выше 70 % области карты, список — прокрутка, шапка с «Закрыть» — над ним.
 */
export function RidePointCard({
  rides,
  now,
  theme,
  onOpen,
  onClose,
}: {
  rides: readonly RideMapPoint[];
  now: Date;
  theme: AppTheme;
  onOpen: (rideId: string) => void;
  onClose: () => void;
}) {
  return (
    <View
      testID="ride-point-card"
      style={[
        styles.card,
        { backgroundColor: theme.surface.raised, borderTopColor: theme.border.subtle },
      ]}
    >
      <View style={styles.head}>
        <Text style={[textStyle('label'), styles.count, { color: theme.text.secondary }]}>
          {rides.length > 1 ? t('rides.map.selected', { count: rides.length }) : ''}
        </Text>
        <TextAction label={t('rides.map.close')} onPress={onClose} />
      </View>
      <ScrollView testID="ride-point-card-list" style={styles.list}>
        {rides.map((ride) => {
          const when = rideHeroDate(ride.startsAt, now);
          const going = goingCaption({ ...ride, phase: 'upcoming' });
          return (
            <Pressable
              key={ride.id}
              accessibilityRole="link"
              accessibilityLabel={meta([ride.title, when, going])}
              onPress={() => onOpen(ride.id)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderTopColor: theme.border.subtle,
                  opacity: pressed ? motion.pressedOpacity : 1,
                },
              ]}
            >
              <Text style={[textStyle('label'), { color: theme.text.secondary }]}>{when}</Text>
              <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>
                {ride.title}
              </Text>
              <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{going}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '70%',
    paddingHorizontal: size.gutter,
    paddingTop: space.s3,
    borderTopWidth: stroke.hairline,
  },
  row: { gap: space.s1, paddingVertical: space.s3, borderTopWidth: stroke.hairline },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.s3 },
  count: { flex: 1 },
  list: { flexGrow: 0 },
});
