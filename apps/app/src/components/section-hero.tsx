import { size, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HeroPhoto } from './hero-photo';
import { PhotoScrim } from './photo-scrim';

export interface SectionHeroProps {
  /** Кикер героя («Окно гонки», «Ближайший старт»); `null` — без строки кикера. */
  kicker: string | null;
  /** Дата крупно и подпись рядом: «4–12» + «октября», «14» + «июня 2027». */
  date: { value: string; unit?: string };
  title: string;
  /** Строки меты под героем (дистанция, покрытия, строка жизненного цикла). */
  meta?: readonly string[];
  /** Переход в карточку объекта (блок 03): блок героя — ссылка, метка для скринридера та же. */
  onPress?: () => void;
  /** Адрес фото героя (фото организатора райда, ride-photo P4): под затемнением, текст — `onPhoto`; нет — типографский. */
  photo?: string | null;
}

/**
 * Герой раздела Главной (`.hero.fb-type` прототипа): кикер → дата → название → линия 1 px, под ним — мета. Без фото —
 * типографский; с `photo` (фото организатора райда) — фото `cover` по центру под затемнением `PhotoScrim`, текст и
 * линия — роль `text.onPhoto`; фото не загрузилось — типографский (вариант с фото — кандидат `HeroCard` в
 * `@rkarakulov/ui`, R8 блока 02). Картинка — `HeroPhoto` (native — `expo-image`, web — `<img>`, есть уже в SSR).
 * Ставится в колонку с полями `gutter`: блок героя выходит во всю ширину экрана.
 * Для скринридера — один элемент «кикер. название. даты» (фото декоративное); с `onPress` — ссылка (роль `link`).
 */
export function SectionHero({ kicker, date, title, meta = [], onPress, photo }: SectionHeroProps) {
  const theme = useTheme();
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const shownPhoto = photo && photo !== failedPhoto ? photo : null;
  const ink = shownPhoto ? theme.text.onPhoto : theme.text.primary;
  const dateText = date.unit ? `${date.value} ${date.unit}` : date.value;
  const Block = onPress ? Pressable : View;

  return (
    <View>
      <Block
        accessible
        accessibilityLabel={kicker ? `${kicker}. ${title}. ${dateText}` : `${title}. ${dateText}`}
        {...(onPress ? { accessibilityRole: 'link' as const, onPress } : {})}
        style={[styles.hero, { backgroundColor: theme.surface.raised }]}
      >
        {shownPhoto ? (
          <>
            <HeroPhoto uri={shownPhoto} onError={() => setFailedPhoto(shownPhoto)} />
            <PhotoScrim />
          </>
        ) : null}
        {kicker ? <Text style={[textStyle('label'), { color: ink }]}>{kicker}</Text> : null}
        <View style={styles.dateRow}>
          <Text style={[textStyle('displayNumeralDate'), { color: ink }]}>{date.value}</Text>
          {date.unit ? (
            <Text
              style={[
                textStyle('titleSm'),
                { color: shownPhoto ? theme.text.onPhoto : theme.text.secondary },
              ]}
            >
              {date.unit}
            </Text>
          ) : null}
        </View>
        <Text style={[textStyle('displaySm'), styles.title, { color: ink }]}>{title}</Text>
        <View testID="section-hero-rule" style={[styles.rule, { backgroundColor: ink }]} />
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
    overflow: 'hidden',
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
