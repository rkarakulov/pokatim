import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Banner,
  EmptyState,
  Pill,
  SkeletonGroup,
  SkeletonListRow,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { loading, RowsSkeleton, TabFailure } from '@/features/races/results-table';

import type { RaceRowView } from './profile-format';

/**
 * Строка гонки истории (`.rr` прототипа; свой и публичный профиль): место крупно (`displayXs`, «=6» при ничьей),
 * название, дата с годом, плашка статуса, уровень и группа, время справа. Вся строка — кнопка в карточку гонки,
 * для скринридера — одна метка.
 */
export function RaceHistoryRow({ row, onPress }: { row: RaceRowView; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.a11y}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.border.subtle }]}
    >
      <Text style={[textStyle('displayXs'), styles.place, { color: theme.text.primary }]}>
        {row.place}
      </Text>
      <View style={styles.main}>
        <Text numberOfLines={1} style={[textStyle('titleSm'), { color: theme.text.primary }]}>
          {row.title}
        </Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{row.date}</Text>
        {row.details ? (
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{row.details}</Text>
        ) : null}
        {row.pill ? (
          <View style={styles.pill}>
            <Pill label={row.pill.label} tone={row.pill.tone} />
          </View>
        ) : null}
      </View>
      {row.time ? (
        <Text style={[textStyle('time'), { color: theme.text.primary }]}>{row.time}</Text>
      ) : null}
    </Pressable>
  );
}

/** Строка райда истории: название, «дата, время · км · роль»; вся строка — кнопка в карточку райда. */
export function RideHistoryRow({
  title,
  details,
  a11y,
  onPress,
}: {
  title: string;
  details: string;
  a11y: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: theme.border.subtle }]}
    >
      <View style={styles.main}>
        <Text numberOfLines={1} style={[textStyle('titleSm'), { color: theme.text.primary }]}>
          {title}
        </Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{details}</Text>
      </View>
    </Pressable>
  );
}

/** Запрос страниц истории: минимум для состояний (`useInfiniteQuery`). */
export interface HistoryQuery<Item> {
  data: { pages: readonly { items: readonly Item[] }[] } | undefined;
  error: unknown;
  isError: boolean;
  isFetchNextPageError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  refetch: () => unknown;
  fetchNextPage: (options: { cancelRefetch: boolean }) => unknown;
}

/**
 * Список истории со состояниями §4.12 (образец — «Гонки на маршруте»): первая загрузка — скелетон строк; ошибка без
 * данных — «Нет соединения» / «Не удалось загрузить» с повтором; пусто — пустое состояние; ошибка обновления — строки
 * остаются, баннер с повтором; «Показать ещё» по курсору — без `onEndReached`, догрузка — скелетон строки, её ошибка —
 * баннер с повтором.
 */
export function HistoryList<Item>({
  testID,
  query,
  failure,
  empty,
  renderRow,
}: {
  testID: string;
  query: HistoryQuery<Item>;
  failure: string;
  empty: { title: string; action?: { label: string; onPress: () => void } };
  renderRow: (item: Item, index: number) => ReactNode;
}) {
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (query.data === undefined) {
    return (
      <View testID={testID}>
        {query.isError || query.fetchStatus === 'paused' ? (
          <TabFailure query={query} message={failure} />
        ) : loading(query) ? (
          <RowsSkeleton />
        ) : null}
      </View>
    );
  }
  if (items.length === 0 && !query.isError) {
    return (
      <View testID={testID}>
        <EmptyState title={empty.title} action={empty.action} />
      </View>
    );
  }
  const refreshFailed = query.isError && !query.isFetchNextPageError;
  // идёт обновление — не догружаем: fetchNextPage по умолчанию отменил бы refetch
  const loadMore = () => {
    if (query.hasNextPage && !query.isFetching) void query.fetchNextPage({ cancelRefetch: false });
  };
  return (
    <View testID={testID}>
      {refreshFailed ? (
        <View style={styles.notice}>
          <Banner tone="warning" title={t('state.staleTitle')} message={t('state.staleMessage')} />
          <View style={styles.start}>
            <TextAction label={t('state.retry')} onPress={() => void query.refetch()} />
          </View>
        </View>
      ) : null}
      {items.map(renderRow)}
      {query.isFetchNextPageError ? (
        <View style={styles.notice}>
          <Banner
            tone="warning"
            title={t('state.failedTitle')}
            message={t('state.failedMessage')}
          />
          <View style={styles.start}>
            <TextAction
              label={t('state.retry')}
              onPress={() => void query.fetchNextPage({ cancelRefetch: false })}
            />
          </View>
        </View>
      ) : query.isFetchingNextPage ? (
        <SkeletonGroup>
          <SkeletonListRow />
        </SkeletonGroup>
      ) : query.hasNextPage ? (
        <View style={[styles.start, styles.more]}>
          <TextAction
            label={t('profile.history.more')}
            disabled={query.isFetching}
            onPress={loadMore}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: size.rowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingVertical: space.s2,
    borderBottomWidth: stroke.hairline,
  },
  place: { minWidth: size.skeletonWord },
  main: { flex: 1, gap: space.s1 },
  pill: { flexDirection: 'row' },
  notice: { gap: space.s3, paddingVertical: space.s3 },
  start: { alignItems: 'flex-start' },
  more: { paddingTop: space.s2 },
});
