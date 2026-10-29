import { size, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import type { FetchStatus } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Состояние запроса живого блока — подмножество `UseQueryResult`. */
export interface LandingSlotQuery<T> {
  data: T | undefined;
  isPending: boolean;
  fetchStatus: FetchStatus;
}

interface LandingSectionProps<T> {
  title: string;
  text: string;
  /** живой блок раздела (G4); без него — только текст (кофе-райды) */
  live?: {
    query: LandingSlotQuery<T>;
    skeleton: ReactNode;
    render: (data: T) => ReactNode;
  };
}

/**
 * Раздел лендинга (RC-7): заголовок, текст и слот живого блока. Слот (G5, RC-4 — отступление от §4.12, лендинг
 * держится на тексте): данные есть — блок; первая загрузка — скелетон; ошибка или `paused` без данных (нет сети) —
 * ничего, без «Не удалось загрузить» и повтора. Ошибка обновления при данных — данные остаются.
 */
export function LandingSection<T>({ title, text, live }: LandingSectionProps<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { borderTopColor: theme.border.subtle }]}>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), { color: theme.text.primary }]}
      >
        {title}
      </Text>
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>{text}</Text>
      {live ? <LiveSlot {...live} /> : null}
    </View>
  );
}

function LiveSlot<T>({ query, skeleton, render }: NonNullable<LandingSectionProps<T>['live']>) {
  if (query.data !== undefined) {
    const content = render(query.data);
    return content === null ? null : <View style={styles.slot}>{content}</View>;
  }
  if (query.isPending && query.fetchStatus === 'fetching') {
    return (
      <View testID="landing-skeleton" style={styles.slot}>
        {skeleton}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  section: {
    borderTopWidth: stroke.hairline,
    paddingTop: size.sectionGap,
    paddingBottom: space.s2,
    gap: space.s3,
  },
  slot: { paddingTop: space.s2 },
});
