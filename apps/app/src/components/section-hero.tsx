import { size, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface SectionHeroProps {
  /** Кикер героя («Окно гонки», «Ближайший старт»). */
  kicker: string;
  /** Дата крупно и подпись рядом: «4–12» + «октября», «14» + «июня 2027». */
  date: { value: string; unit?: string };
  title: string;
  /** Строки меты под героем (дистанция, покрытия, строка жизненного цикла). */
  meta?: readonly string[];
  /** Переход в карточку объекта (блок 03): блок героя — ссылка, метка для скринридера та же. */
  onPress?: () => void;
}

/**
 * Типографский герой раздела Главной (`.hero.fb-type` прототипа): кикер → дата → название → линия 1 px, под ним —
 * мета. Обложек нет (нет `media`), поэтому всегда типографский; вариант с фото и скримом — кандидат `HeroCard` в
 * `@rkarakulov/ui` (R8 блока 02). Ставится в колонку с полями `gutter`: блок героя выходит во всю ширину экрана.
 * Для скринридера — один элемент «кикер. название. даты»; с `onPress` — ссылка (роль `link`), без него не нажимается.
 */
export function SectionHero({ kicker, date, title, meta = [], onPress }: SectionHeroProps) {
  const theme = useTheme();
  const dateText = date.unit ? `${date.value} ${date.unit}` : date.value;
  const Block = onPress ? Pressable : View;

  return (
    <View>
      <Block
        accessible
        accessibilityLabel={`${kicker}. ${title}. ${dateText}`}
        {...(onPress ? { accessibilityRole: 'link' as const, onPress } : {})}
        style={[styles.hero, { backgroundColor: theme.surface.raised }]}
      >
        <Text style={[textStyle('label'), { color: theme.text.primary }]}>{kicker}</Text>
        <View style={styles.dateRow}>
          <Text style={[textStyle('displayNumeralDate'), { color: theme.text.primary }]}>
            {date.value}
          </Text>
          {date.unit ? (
            <Text style={[textStyle('titleSm'), { color: theme.text.secondary }]}>{date.unit}</Text>
          ) : null}
        </View>
        <Text style={[textStyle('displaySm'), styles.title, { color: theme.text.primary }]}>
          {title}
        </Text>
        <View
          testID="section-hero-rule"
          style={[styles.rule, { backgroundColor: theme.text.primary }]}
        />
      </Block>
      {meta.length > 0 ? (
        <View style={styles.meta}>
          {meta.map((line) => (
            <Text key={line} style={[textStyle('meta'), { color: theme.text.secondary }]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: size.heroHeight,
    justifyContent: 'flex-end',
    marginHorizontal: -size.gutter,
    paddingHorizontal: size.gutter,
    paddingVertical: space.s5,
  },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.s2,
    marginTop: space.s2,
  },
  title: { marginTop: space.s1 },
  rule: { height: stroke.hairline, marginTop: space.s3 },
  meta: { paddingTop: space.s3, gap: space.s1 },
});
