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
  /** Пояснение под подписью (routes-03): «круговой», «макс. 267 м», «при 27 км/ч». */
  note?: string;
}

/**
 * Стат-блок (`.stats` прототипа): ink-линия сверху, ячейки в ряд с hairline-разделителями, значение `displayStat` с
 * единицей и подпись `label`; ячейка — по содержимому (не уже `size.rowMin`), не влезла — новый ряд; «км» при крупном
 * шрифте переносится под значение; необязательное пояснение `note` — строкой под подписью. Для скринридера — одна
 * метка на ячейку «Дистанция 100 км» (с пояснением — «Дистанция 68 км круговой»). Кандидат в `@rkarakulov/ui` (§5.1).
 * `variant="compact"` (routes-04d, RC-9) — строка шторки карточки маршрута: один ряд равных колонок без ink-линии,
 * подпись над значением, значение `bodyStrong` с единицей в одну строку (без переноса); `note` не показывается, но
 * остаётся в метке ячейки.
 */
export function StatBlock({
  items,
  equalColumns = false,
  variant = 'default',
}: {
  items: readonly StatItem[];
  /**
   * routes-04 (RC-11): ячейки равной ширины в один ряд (карточка маршрута — три колонки на 375 px); значение и подписи
   * переносятся внутри ячейки. По умолчанию — ширина по содержимому с переносом рядами (календарь, кофе-райд).
   */
  equalColumns?: boolean;
  variant?: 'default' | 'compact';
}) {
  const theme = useTheme();
  if (variant === 'compact') return <CompactStats items={items} />;
  return (
    <View testID="stat-block" style={[styles.block, { borderTopColor: theme.text.primary }]}>
      {items.map((item, index) => (
        <View
          // значения могут повторяться — ключ по позиции (список статичен)
          key={index}
          testID="stat-block-cell"
          accessible
          accessibilityLabel={[item.label, item.value, item.unit, item.note]
            .filter(Boolean)
            .join(' ')}
          style={[
            styles.cell,
            equalColumns ? styles.equal : null,
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
          {item.note ? (
            <Text style={[textStyle('label'), { color: theme.text.secondary }]}>{item.note}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function CompactStats({ items }: { items: readonly StatItem[] }) {
  const theme = useTheme();
  return (
    <View testID="stat-block" style={styles.compactRow}>
      {items.map((item, index) => (
        <View
          key={index}
          testID="stat-block-cell"
          accessible
          accessibilityLabel={[item.label, item.value, item.unit, item.note]
            .filter(Boolean)
            .join(' ')}
          style={styles.compactCell}
        >
          <Text numberOfLines={1} style={[textStyle('label'), { color: theme.text.secondary }]}>
            {item.label}
          </Text>
          <Text
            testID="stat-block-value"
            numberOfLines={1}
            style={[textStyle('bodyStrong'), { color: theme.text.primary }]}
          >
            {item.value}
            {item.unit ? (
              <Text style={[textStyle('unit'), { color: theme.text.secondary }]}>
                {` ${item.unit}`}
              </Text>
            ) : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  compactRow: { flexDirection: 'row', columnGap: size.statGap },
  // равные колонки в один ряд; узко — значение обрезается многоточием, а не переносится
  compactCell: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: space.s1 },
  block: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: stroke.hairline },
  // ширина — по содержимому (не сжимается в ноль), не уже строки списка; не влезло в ряд — переносится в следующий
  cell: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: size.rowMin,
    paddingTop: space.s3,
  },
  // равные колонки: базис 0 и сжатие — три ячейки делят ряд поровну, текст переносится внутри
  equal: { flexBasis: 0, flexShrink: 1 },
  first: { paddingRight: size.statGap },
  next: { paddingHorizontal: size.statGap, borderLeftWidth: stroke.hairline },
  // крупный шрифт: «км» уходит под значение, а не обрезается
  valueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.s1 },
  label: { marginTop: space.s1 },
});
