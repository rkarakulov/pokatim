import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Chip, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { formatDistances } from '@/lib/minsk-format';

/**
 * Выбор дистанции регистрации на старт (event-tickets §6): `Chip`-радиогруппа с подписью (роль radio у `Chip` — задача
 * в app-foundation, как `group-picker`). Значения — только `distancesKm` сервера.
 */
export function DistancePicker({
  distances,
  value,
  onChange,
}: {
  distances: readonly number[];
  value: number | null;
  onChange: (distance: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('calendar.registration.distance')}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('calendar.registration.distance')}
        testID="distance-picker"
        style={styles.chips}
      >
        {distances.map((distance) => (
          <Chip
            key={distance}
            label={formatDistances([distance]) ?? ''}
            selected={distance === value}
            onPress={() => onChange(distance)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
});
