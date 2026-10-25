import { size, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

export interface StatItem {
  /** Значение крупно: «100». */
  value: string;
  /** Единица рядом мелко: «км». */
  unit?: string;
  /** Подпись под значением: «Дистанция». */
  label: string;
}

/**
 * Стат-блок (`.stats` прототипа): ink-линия сверху, ячейки в ряд с hairline-разделителями, значение `displayStat` с
 * единицей и подпись `label`; ячейка — по содержимому (не уже `size.rowMin`), не влезла — новый ряд; «км» при крупном
 * шрифте переносится под значение. Для скринридера — одна метка на
 * ячейку «Дистанция 100 км». Кандидат в `@rkarakulov/ui` (§5.1).
 */
export function StatBlock({ items }: { items: readonly StatItem[] }) {
  const theme = useTheme();
  return (
    <View testID="stat-block" style={[styles.block, { borderTopColor: theme.text.primary }]}>
      {items.map((item, index) => (
        <View
          // значения могут повторяться — ключ по позиции (список статичен)
          key={index}
          testID="stat-block-cell"
          accessible
          accessibilityLabel={[item.label, item.value, item.unit].filter(Boolean).join(' ')}
          style={[
            styles.cell,
            index === 0 ? styles.first : [styles.next, { borderLeftColor: theme.border.subtle }],
          ]}
        >
          <View testID="stat-block-value" style={styles.valueRow}>
            <Text style={[textStyle('displayStat'), { color: theme.text.primary }]}>
              {item.value}
            </Text>
            {item.unit ? (
              <Text style={[textStyle('unit'), { color: theme.text.secondary }]}>{item.unit}</Text>
            ) : null}
          </View>
          <Text style={[textStyle('label'), styles.label, { color: theme.text.secondary }]}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: stroke.hairline },
  // ширина — по содержимому (не сжимается в ноль), не уже строки списка; не влезло в ряд — переносится в следующий
  cell: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: size.rowMin,
    paddingTop: space.s3,
  },
  first: { paddingRight: size.statGap },
  next: { paddingHorizontal: size.statGap, borderLeftWidth: stroke.hairline },
  // крупный шрифт: «км» уходит под значение, а не обрезается
  valueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.s1 },
  label: { marginTop: space.s1 },
});
