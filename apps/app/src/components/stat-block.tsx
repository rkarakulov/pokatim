import { shapeOf, size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import type { ComponentType } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

export interface StatItem {
  /** Значение крупно: «100». */
  value: string;
  /** Единица рядом мелко: «км». */
  unit?: string;
  /** Подпись под значением: «Дистанция». */
  label: string;
  /** Пояснение под подписью (routes-03): «круговой», «макс. 267 м», «при 27 км/ч». */
  note?: string;
  /**
   * Значение по частям с единицами («3» «ч», «35» «мин»): плитки (`tiles`) переносят его частями, а не обрезают.
   * Нет — одна часть `value` + `unit`.
   */
  parts?: readonly { value: string; unit: string }[];
}

/**
 * Стат-блок (`.stats` прототипа): ink-линия сверху, ячейки в ряд с hairline-разделителями, значение `displayStat` с
 * единицей и подпись `label`; ячейка — по содержимому (не уже `size.rowMin`), не влезла — новый ряд; «км» при крупном
 * шрифте переносится под значение; необязательное пояснение `note` — строкой под подписью. Для скринридера — одна
 * метка на ячейку «Дистанция 100 км» (с пояснением — «Дистанция 68 км круговой»). Кандидат в `@rkarakulov/ui` (§5.1).
 * `variant="compact"` (routes-04d, RC-9) — строка шторки карточки маршрута: один ряд равных колонок без ink-линии,
 * подпись над значением, значение `bodyStrong` с единицей в одну строку (без переноса; при крупном системном шрифте —
 * перенос внутри колонки, не многоточие); `note` не показывается, но остаётся в метке ячейки.
 * `variant="tiles"` / `"numeral"` (app-themes C2) — шапка шторки у тем с плитками и с крупной цифрой.
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
  variant?: StatVariant;
}) {
  const Variant = STAT_VARIANTS[variant];
  return <Variant items={items} equalColumns={equalColumns} />;
}

export type StatVariant = 'default' | 'compact' | 'tiles' | 'numeral';

interface StatsProps {
  items: readonly StatItem[];
  equalColumns: boolean;
}

/** Метка ячейки для скринридера: «Дистанция 68 км круговой». */
const cellLabel = (item: StatItem) =>
  [item.label, item.value, item.unit, item.note].filter(Boolean).join(' ');

/** Крупный системный шрифт — перенос вместо многоточия: текст не теряется (ревью pass 1, M1). */
const useSingleLine = () => (useWindowDimensions().fontScale > 1 ? undefined : 1);

function DefaultStats({ items, equalColumns }: StatsProps) {
  const theme = useTheme();
  return (
    <View testID="stat-block" style={[styles.block, { borderTopColor: theme.text.primary }]}>
      {items.map((item, index) => (
        <View
          // значения могут повторяться — ключ по позиции (список статичен)
          key={index}
          testID="stat-block-cell"
          accessible
          accessibilityLabel={cellLabel(item)}
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

function CompactStats({ items }: Pick<StatsProps, 'items'>) {
  return (
    <View testID="stat-block" style={styles.compactRow}>
      <CompactCells items={items} />
    </View>
  );
}

function CompactCells({ items }: Pick<StatsProps, 'items'>) {
  const theme = useTheme();
  const lines = useSingleLine();
  return (
    <>
      {items.map((item, index) => (
        <View
          key={index}
          testID="stat-block-cell"
          accessible
          accessibilityLabel={cellLabel(item)}
          style={styles.compactCell}
        >
          <Text numberOfLines={lines} style={[textStyle('label'), { color: theme.text.secondary }]}>
            {item.label}
          </Text>
          <Text
            testID="stat-block-value"
            numberOfLines={lines}
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
    </>
  );
}

/**
 * Плитки (Хронометр, Навигация): три равные плитки с радиусом `shape.card` на фоне экрана `surface.default` — шторка,
 * где они стоят, уже `surface.sheet` (= `surface.raised` у тем). Значение `displayNumeral36` частями с единицами
 * (`parts`: «3 ч» / «35 мин»); плитки — по содержимому и переносятся рядами, части и подпись — строками: без
 * многоточия при любой ширине и размере шрифта.
 */
function TileStats({ items }: Pick<StatsProps, 'items'>) {
  const theme = useTheme<AppTheme>();
  return (
    <View testID="stat-block" style={[styles.compactRow, styles.tileRow]}>
      {items.map((item, index) => (
        <View
          key={index}
          testID="stat-block-cell"
          accessible
          accessibilityLabel={cellLabel(item)}
          style={[
            styles.tile,
            { backgroundColor: theme.surface.default, borderRadius: shapeOf(theme).card },
          ]}
        >
          <View testID="stat-block-value" style={styles.tileValue}>
            {(item.parts ?? [{ value: item.value, unit: item.unit }]).map((part, partIndex) => (
              <View key={partIndex} style={styles.valueRow}>
                <Text style={[textStyle('displayNumeral36'), { color: theme.text.primary }]}>
                  {part.value}
                </Text>
                {part.unit ? (
                  <Text style={[textStyle('unit'), { color: theme.text.secondary }]}>
                    {part.unit}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
          <Text style={[textStyle('label'), styles.label, { color: theme.text.secondary }]}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Крупная цифра (Типографика): первая ячейка (дистанция) — `displayNumeral` с единицей, остальные — строкой `compact`
 * справа, а не помещаются — под ней.
 */
function NumeralStats({ items }: Pick<StatsProps, 'items'>) {
  const theme = useTheme();
  const [first, ...rest] = items;
  if (!first) return null;
  return (
    <View testID="stat-block" style={styles.numeralRow}>
      <View
        testID="stat-block-numeral"
        accessible
        accessibilityLabel={cellLabel(first)}
        style={styles.valueRow}
      >
        <Text style={[textStyle('displayNumeral'), { color: theme.text.primary }]}>
          {first.value}
        </Text>
        {first.unit ? (
          <Text style={[textStyle('unit'), { color: theme.text.secondary }]}>{first.unit}</Text>
        ) : null}
      </View>
      {rest.length > 0 ? (
        <View style={[styles.compactRow, styles.numeralRest]}>
          <CompactCells items={rest} />
        </View>
      ) : null}
    </View>
  );
}

/** Вариант стат-блока (полноту таблицы проверяет тип). */
const STAT_VARIANTS: Record<StatVariant, ComponentType<StatsProps>> = {
  default: DefaultStats,
  compact: CompactStats,
  tiles: TileStats,
  numeral: NumeralStats,
};

/** Скелетон строки цифр шторки (`compact`) — как прежде: две строки. */
function CompactSkeleton() {
  return (
    <View testID="stat-skeleton-compact">
      <SkeletonText variant="bodyStrong" lines={2} lastLineWidth="60%" />
    </View>
  );
}

/** Скелетон плиток: три плитки той же формы, внутри — значение и подпись. */
function TileSkeleton() {
  const theme = useTheme<AppTheme>();
  return (
    <View testID="stat-skeleton-tiles" style={[styles.compactRow, styles.tileRow]}>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={[
            styles.tile,
            { backgroundColor: theme.surface.default, borderRadius: shapeOf(theme).card },
          ]}
        >
          <SkeletonText variant="displayNumeral36" lines={1} lastLineWidth="70%" />
          <SkeletonText variant="label" lines={1} lastLineWidth="80%" />
        </View>
      ))}
    </View>
  );
}

/** Скелетон крупной цифры: дистанция и строка `compact` справа. */
function NumeralSkeleton() {
  return (
    <View testID="stat-skeleton-numeral" style={styles.numeralRow}>
      <View style={styles.numeralSkeleton}>
        <SkeletonText variant="displayNumeral" lines={1} />
      </View>
      <View style={styles.numeralRest}>
        <SkeletonText variant="bodyStrong" lines={2} lastLineWidth="60%" />
      </View>
    </View>
  );
}

/** Скелетон стат-блока по варианту (первая загрузка шторки повторяет раскладку шапки). */
const STAT_SKELETONS: Record<Exclude<StatVariant, 'default'>, ComponentType> = {
  compact: CompactSkeleton,
  tiles: TileSkeleton,
  numeral: NumeralSkeleton,
};

export function StatBlockSkeleton({ variant }: { variant: Exclude<StatVariant, 'default'> }) {
  const Skeleton = STAT_SKELETONS[variant];
  return <Skeleton />;
}

const styles = StyleSheet.create({
  compactRow: { flexDirection: 'row', columnGap: size.statGap },
  // равные колонки в один ряд; при обычном шрифте — одна строка, при крупном — перенос внутри колонки
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
  // ширина — по содержимому, не уже строки списка; не влезли в ряд (широкая гарнитура, длинное время) — новый ряд
  tile: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: size.rowMin,
    // по горизонтали — уже: подпись «ДИСТАНЦИЯ» и «123,4» в трети ширины телефона 360 px
    paddingHorizontal: space.s2,
    paddingVertical: space.s3,
  },
  // плитки — с узким зазором (s1), переносятся рядами
  tileRow: { flexWrap: 'wrap', columnGap: space.s1, rowGap: space.s1 },
  tileValue: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.s2,
  },
  numeralRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    columnGap: size.statGap,
    rowGap: space.s2,
  },
  // строка compact справа от цифры: не уже двух строк списка, иначе — под цифрой
  numeralSkeleton: { width: size.rowMin * 2 },
  numeralRest: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: size.rowMin * 2 },
});
