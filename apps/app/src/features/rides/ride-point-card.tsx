import type { RideMapPoint } from '@pokatim/contracts';
import { motion, size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { meta } from '@/lib/minsk-format';

import { goingCaption, rideHeroDate } from './format';

/**
 * Карточка выбранной точки карты ленты (05c, RC-11) — поверх нижнего края карты (`surface.raised`): райды группы
 * (одна точка старта — несколько райдов популярного маршрута), каждый — ссылка на карточку райда: название, дата,
 * «идут N из M». «Закрыть» снимает выбор. Путь без карты для скринридера и клавиатуры — режим «Список».
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
      {rides.length > 1 ? (
        <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
          {t('rides.map.selected', { count: rides.length })}
        </Text>
      ) : null}
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
              { borderTopColor: theme.border.subtle, opacity: pressed ? motion.pressedOpacity : 1 },
            ]}
          >
            <Text style={[textStyle('label'), { color: theme.text.secondary }]}>{when}</Text>
            <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{ride.title}</Text>
            <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{going}</Text>
          </Pressable>
        );
      })}
      <View style={styles.close}>
        <TextAction label={t('rides.map.close')} onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: size.gutter,
    paddingTop: space.s3,
    borderTopWidth: stroke.hairline,
  },
  row: { gap: space.s1, paddingVertical: space.s3, borderTopWidth: stroke.hairline },
  close: { alignItems: 'flex-start' },
});
