import type { YearMonth } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  EmptyState,
  SkeletonGroup,
  SkeletonHeroCard,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CalendarListRow, CalendarListRowSkeleton } from '@/components/calendar-list-row';
import { FilterGroup, FilterGroupSkeleton } from '@/components/filter-group';
import { OfflineBanner } from '@/components/offline-banner';
import { monthChipLabel } from '@/lib/filter-chips';
import { domainLabel } from '@/lib/minsk-format';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { CalendarStartHero } from './calendar-hero';
import {
  DISCIPLINE_CHIPS,
  groupByMonth,
  hasFilters,
  NO_FILTERS,
  toggleWithinLimit,
  withinAvailable,
  type CalendarFilters,
  type FeedRow,
} from './filters';
import { monthGroupLabel } from './format';
import { useCalendarCities, useCalendarFeed, useCalendarMonths } from './queries';

type FeedItem = { kind: 'all' } | FeedRow;

const SKELETON_ROWS = [0, 1, 2];

const itemKey = (item: FeedItem) =>
  item.kind === 'all' ? 'all' : item.kind === 'month' ? `m-${item.month}` : `s-${item.start.id}`;

/** Состояние чипов из данных: до ответа — скелетон, ошибка или пусто — группа скрыта (список работает без неё). */
type ChipSource<T extends string> = {
  data: readonly T[] | undefined;
  loading: boolean;
};

function DataFilterGroup<T extends string>({
  label,
  source,
  selected,
  labelOf,
  onToggle,
}: {
  label: string;
  source: ChipSource<T>;
  selected: readonly T[];
  labelOf: (value: T) => string;
  onToggle: (value: T) => void;
}) {
  if (source.data === undefined) {
    return source.loading ? <FilterGroupSkeleton label={label} /> : null;
  }
  if (source.data.length === 0) return null;
  return (
    <FilterGroup
      label={label}
      options={source.data.map((value) => ({ value, label: labelOf(value) }))}
      selected={selected}
      onToggle={onToggle}
    />
  );
}

export interface CalendarFeedProps {
  /** Шапка вкладки (кикер, заголовок, лид) — видна при любом состоянии данных. */
  header: ReactNode;
  filters: CalendarFilters;
  onFiltersChange: (filters: CalendarFilters) => void;
}

/**
 * Лента вкладки «Календарь» (§3, §7): шапка и фильтры — сразу; герой — первая запись выдачи; «Все старты» —
 * остальные, с подписями месяцев начала. Подгрузка у конца (`FlatList.onEndReached`), в подвале — скелетон строки
 * или баннер ошибки догрузки с повтором (загруженное остаётся). Смена фильтра — новый ключ: скелетон на месте данных.
 * Выбранный месяц или город, которых больше нет в ответах `months` / `cities`, в запрос и в чипы не идут.
 */
export function CalendarFeed({ header, filters: selected, onFiltersChange }: CalendarFeedProps) {
  const theme = useTheme();
  const router = useRouter();
  const months = useCalendarMonths();
  const cities = useCalendarCities();
  const filters = withinAvailable(selected, {
    months: months.data?.months,
    cities: cities.data?.cities,
  });
  const { feed, loadMore } = useCalendarFeed(filters);
  const now = useMinskClock([feed.dataUpdatedAt]);
  const filtered = hasFilters(filters);
  const openStart = (id: string) => router.push(`/calendar/${id}`);

  const refetchers = useMemo(
    () => [feed.refetch, months.refetch, cities.refetch],
    [feed.refetch, months.refetch, cities.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const rest = (feed.data?.pages ?? []).flatMap((page) => page.items).slice(1);
  const rows = groupByMonth(rest);
  const items: FeedItem[] = rows.length > 0 ? [{ kind: 'all' }, ...rows] : [];

  // ошибка догрузки страницы — баннер в подвале, а не над героем: данные остаются
  const feedState = { ...feed, isError: feed.isError && !feed.isFetchNextPageError };
  const resetFilters = () => onFiltersChange(NO_FILTERS);
  // офлайн-старт: запрос чипов на паузе — группа скрыта, а не вечный скелетон
  const loading = (query: { isPending: boolean; fetchStatus: string }) =>
    query.isPending && query.fetchStatus === 'fetching';

  const listHeader = (
    <View style={styles.gutter}>
      {header}
      <OfflineBanner hasData={feed.data !== undefined} style={styles.offline} />
      <View style={styles.filters}>
        <DataFilterGroup<YearMonth>
          label={t('calendar.filter.date')}
          source={{ data: months.data?.months, loading: loading(months) }}
          selected={filters.month}
          labelOf={(value) => monthChipLabel(value, now)}
          onToggle={(value) =>
            onFiltersChange({ ...filters, month: toggleWithinLimit(filters.month, value) })
          }
        />
        <FilterGroup
          label={t('calendar.filter.discipline')}
          options={DISCIPLINE_CHIPS.map((value) => ({
            value,
            label: domainLabel('domain.discipline', value) ?? value,
          }))}
          selected={filters.discipline}
          onToggle={(value) =>
            onFiltersChange({
              ...filters,
              discipline: toggleWithinLimit(filters.discipline, value),
            })
          }
        />
        <DataFilterGroup<string>
          label={t('calendar.filter.city')}
          source={{ data: cities.data?.cities, loading: loading(cities) }}
          selected={filters.city}
          labelOf={(value) => value}
          onToggle={(value) =>
            onFiltersChange({ ...filters, city: toggleWithinLimit(filters.city, value) })
          }
        />
      </View>
      {filtered ? (
        <View style={styles.reset}>
          <TextAction label={t('calendar.resetFilters')} onPress={resetFilters} />
        </View>
      ) : null}
      <View style={styles.hero}>
        <AsyncContent
          query={feedState}
          skeleton={
            <View style={styles.skeleton}>
              <SkeletonHeroCard />
              {SKELETON_ROWS.map((index) => (
                <CalendarListRowSkeleton key={index} />
              ))}
            </View>
          }
          empty={{
            when: (data) => (data.pages[0]?.items.length ?? 0) === 0,
            render: () =>
              filtered ? (
                <EmptyState
                  title={t('calendar.noMatchTitle')}
                  message={t('calendar.noMatch')}
                  action={{ label: t('calendar.resetFilters'), onPress: resetFilters }}
                />
              ) : (
                <EmptyState title={t('calendar.empty')} />
              ),
          }}
        >
          {(data) => {
            const start = data.pages[0]?.items[0];
            return start ? (
              <CalendarStartHero
                start={start}
                now={now}
                kicker={t(filtered ? 'calendar.heroKickerFiltered' : 'calendar.heroKicker')}
                onPress={() => openStart(start.id)}
              />
            ) : null;
          }}
        </AsyncContent>
      </View>
    </View>
  );

  const footer = (
    <View style={[styles.gutter, styles.footer]}>
      {feed.isFetchNextPageError && feed.data ? (
        <View style={styles.footerError}>
          <Banner
            tone="warning"
            title={t('state.failedTitle')}
            message={t('state.failedMessage')}
          />
          <TextAction label={t('state.retry')} onPress={() => void feed.fetchNextPage()} />
        </View>
      ) : feed.isFetchingNextPage ? (
        <SkeletonGroup>
          <CalendarListRowSkeleton />
        </SkeletonGroup>
      ) : null}
    </View>
  );

  return (
    <FlatList
      testID="calendar-feed"
      data={feed.data ? items : []}
      keyExtractor={itemKey}
      ListHeaderComponent={listHeader}
      ListFooterComponent={footer}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={theme.text.secondary}
          colors={[theme.text.primary]}
          progressBackgroundColor={theme.surface.raised}
        />
      }
      renderItem={({ item }) => (
        <View style={styles.gutter}>
          {item.kind === 'all' ? (
            <Text
              accessibilityRole="header"
              style={[textStyle('displaySm'), styles.all, { color: theme.text.primary }]}
            >
              {t('calendar.all')}
            </Text>
          ) : item.kind === 'month' ? (
            <Text
              accessibilityRole="header"
              style={[textStyle('label'), styles.group, { color: theme.text.secondary }]}
            >
              {monthGroupLabel(item.month)}
            </Text>
          ) : (
            <CalendarListRow
              start={item.start}
              now={now}
              onPress={() => openStart(item.start.id)}
            />
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  gutter: { paddingHorizontal: size.gutter },
  filters: { marginTop: space.s2 },
  offline: { marginTop: space.s2 },
  reset: { alignItems: 'flex-start' },
  hero: { marginTop: space.s3 },
  skeleton: { gap: space.s3 },
  all: { marginTop: size.sectionGap },
  group: { marginTop: space.s5, marginBottom: space.s2 },
  footer: { paddingBottom: space.s6 },
  footerError: { gap: space.s3, paddingTop: space.s3 },
});
