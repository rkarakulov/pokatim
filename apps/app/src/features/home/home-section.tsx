import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  SectionHeader,
  SkeletonHeroCard,
  TextAction,
  useTheme,
  type AsyncContentProps,
  type AsyncState,
} from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

export interface HomeSectionProps<T> {
  kicker: string;
  title: string;
  /** Раздел отмечен в опросе — тег «по вашему выбору» (Q4). */
  chosen: boolean;
  /** Первый раздел ленты — без линии сверху. */
  first: boolean;
  /** «Все гонки» / «Все старты» — переход во вкладку раздела. */
  all: { label: string; onPress: () => void };
  query: AsyncState<T>;
  empty?: AsyncContentProps<T>['empty'];
  /** скелетон героя (по умолчанию — `SkeletonHeroCard`; раздел с вариантом героя темы — свой) */
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}

/**
 * Раздел Главной (`.sec` прототипа): шапка видна сразу, состояния данных — только в слоте героя (§4.12): скелетон
 * героя, «Нет соединения» / «Не удалось загрузить» с повтором, пустой герой, баннер при ошибке обновления. Сбой
 * одного раздела не трогает другие.
 */
export function HomeSection<T>({
  kicker,
  title,
  chosen,
  first,
  all,
  query,
  empty,
  skeleton = <SkeletonHeroCard />,
  children,
}: HomeSectionProps<T>) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.section,
        first ? styles.first : { borderTopColor: theme.border.subtle, ...styles.divided },
      ]}
    >
      <SectionHeader
        kicker={kicker}
        kickerTag={chosen ? t('home.chosenTag') : undefined}
        title={title}
      />
      <AsyncContent query={query} skeleton={skeleton} empty={empty}>
        {children}
      </AsyncContent>
      <View style={styles.all}>
        <TextAction label={all.label} onPress={all.onPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: size.gutter, paddingTop: size.sectionGap },
  first: { paddingTop: space.s2 },
  divided: { borderTopWidth: stroke.hairline },
  all: { paddingVertical: space.s3, alignItems: 'flex-start' },
});
