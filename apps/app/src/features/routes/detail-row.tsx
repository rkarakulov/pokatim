import { space } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Строка карточки маршрута (каталог и мой маршрут): подпись и значение. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>{label}</Text>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.s1 },
});
