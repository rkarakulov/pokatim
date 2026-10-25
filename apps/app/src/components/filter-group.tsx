import { size, space } from '@pokatim/design-tokens';
import { Chip, textStyle, useTheme } from '@rkarakulov/ui';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

export interface FilterGroupProps<T extends string> {
  /** Подпись группы колонкой слева («Класс», «Дата»). */
  label: string;
  options: readonly FilterOption<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  testID?: string;
}

/**
 * Группа фильтров (`.fgroup` прототипа): подпись колонкой и ряд `Chip`, уходящий за правый край (горизонтальная
 * прокрутка). Внутри группы — несколько значений сразу (ИЛИ делает сервер). Кандидат в `@rkarakulov/ui` (§5.1).
 */
export function FilterGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
  testID,
}: FilterGroupProps<T>) {
  const theme = useTheme();
  return (
    <View style={styles.group}>
      <Text style={[textStyle('label'), styles.label, { color: theme.text.secondary }]}>
        {label}
      </Text>
      <ScrollView
        testID={testID}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.chips}
      >
        {options.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={selected.includes(option.value)}
            onPress={() => onToggle(option.value)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', alignItems: 'center', minHeight: size.touchMin },
  label: { width: '28%' },
  // ряд уходит за правый край экрана (поле гаттера — тоже зона прокрутки)
  scroll: { flex: 1, marginRight: -size.gutter },
  chips: { gap: space.s2, paddingVertical: space.s1, paddingRight: size.gutter },
});
