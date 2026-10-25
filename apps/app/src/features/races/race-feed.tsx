import type { RaceCard } from '@pokatim/contracts';
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

import { FilterGroup } from '@/components/filter-group';
import { OfflineBanner } from '@/components/offline-banner';
import { RaceListCard, RaceListCardSkeleton } from '@/components/race-list-card';
import { SectionHero } from '@/components/section-hero';
import { monthChipLabel, toggle } from '@/lib/filter-chips';
import { domainLabel } from '@/lib/minsk-format';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import {
  CLASS_CHIPS,
  hasFilters,
  monthChips,
  NO_FILTERS,
  noMatchMessage,
  type RaceFilters,
} from './filters';
import { formatRaceWindow, raceHeroLine, raceHeroMeta } from './format';
import { useRaceFeed } from './queries';

type FeedItem =
  | { kind: 'all'; key: string }
  | { kind: 'group'; key: string; title: string }
  | { kind: 'race'; key: string; race: RaceCard };

const SKELETON_CARDS = [0, 1, 2];

export interface RaceFeedProps {
  /** Шапка вкладки (заголовок, кнопка сезона) — видна при любом состоянии данных. */
  header: ReactNode;
  filters: RaceFilters;
  onFiltersChange: (filters: RaceFilters) => void;
}

/**
 * Лента вкладки «Гонки» (§3, §7): шапка и фильтры — сразу; герой — первая `current`-гонка; «Все гонки» — группа
 * «Скоро» (остальное `current`) и «Завершённые» (`past`, после исчерпания `current`, Q4). Подгрузка — у конца
 * списка (`FlatList.onEndReached`), в подвале — скелетон карточки или баннер ошибки догрузки с повтором (загруженное
 * остаётся). Смена фильтра — новый ключ запроса: на месте данных скелетон (R7, без `keepPreviousData`).
 */
export function RaceFeed({ header, filters: selected, onFiltersChange }: RaceFeedProps) {
  const theme = useTheme();
  const router = useRouter();
  // чипы месяцев — от «сейчас» по Минску (полночь и возврат в фокус пересчитывают); выбранный месяц, которого среди
  // чипов больше нет (сменился месяц на открытом экране), в запрос и в состояние чипов не идёт
  const months = monthChips(useMinskClock([]));
  const filters: RaceFilters = {
    ...selected,
    month: selected.month.filter((month) => months.includes(month)),
  };
  const { current, past, pastEnabled, loadMore } = useRaceFeed(filters);
  const now = useMinskClock([current.dataUpdatedAt, past.dataUpdatedAt]);
  const filtered = hasFilters(filters);
  const openRace = (id: string) => router.push(`/races/${id}`);

  const refetchers = useMemo(
    () => (pastEnabled ? [current.refetch, past.refetch] : [current.refetch]),
    [pastEnabled, current.refetch, past.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const currentPages = current.data?.pages ?? [];
  const soon = currentPages.flatMap((page) => page.items).slice(1);
  const finished = past.data?.pages.flatMap((page) => page.items) ?? [];
  const items: FeedItem[] = [];
  if (soon.length > 0 || finished.length > 0) items.push({ kind: 'all', key: 'all' });
  if (soon.length > 0) {
    items.push({ kind: 'group', key: 'group-soon', title: t('races.group.soon') });
    items.push(...soon.map((race) => ({ kind: 'race' as const, key: `c-${race.id}`, race })));
  }
  if (finished.length > 0) {
    items.push({ kind: 'group', key: 'group-finished', title: t('races.group.finished') });
    items.push(...finished.map((race) => ({ kind: 'race' as const, key: `p-${race.id}`, race })));
  }

  // ошибка догрузки страницы — баннер в подвале, а не над героем: данные остаются
  const currentState = { ...current, isError: current.isError && !current.isFetchNextPageError };
  const resetFilters = () => onFiltersChange(NO_FILTERS);

  const listHeader = (
    <View style={styles.gutter}>
      {header}
      <OfflineBanner hasData={current.data !== undefined} style={styles.offline} />
      <View style={styles.filters}>
        <FilterGroup
          label={t('races.filter.class')}
          options={CLASS_CHIPS.map((value) => ({
            value,
            label: domainLabel('domain.bikeClass', value) ?? value,
          }))}
          selected={filters.bikeClass}
          onToggle={(value) =>
            onFiltersChange({ ...filters, bikeClass: toggle(filters.bikeClass, value) })
          }
        />
        <FilterGroup
          label={t('races.filter.date')}
          options={months.map((value) => ({ value, label: monthChipLabel(value, now) }))}
          selected={filters.month}
          onToggle={(value) => onFiltersChange({ ...filters, month: toggle(filters.month, value) })}
        />
      </View>
      {filtered ? (
        <View style={styles.reset}>
          <TextAction label={t('races.resetFilters')} onPress={resetFilters} />
        </View>
      ) : null}
      <View style={styles.hero}>
        <AsyncContent
          query={currentState}
          skeleton={
            <View style={styles.skeleton}>
              <SkeletonHeroCard />
              {SKELETON_CARDS.map((index) => (
                <RaceListCardSkeleton key={index} />
              ))}
            </View>
          }
          empty={{
            when: (data) => (data.pages[0]?.items.length ?? 0) === 0,
            render: () =>
              filtered ? (
                <EmptyState
                  title={t('races.noMatchTitle')}
                  message={noMatchMessage(filters)}
                  action={{ label: t('races.resetFilters'), onPress: resetFilters }}
                />
              ) : (
                <EmptyState
                  title={t('races.empty')}
                  action={{
                    label: t('races.emptyAction'),
                    onPress: () => router.navigate('/calendar'),
                  }}
                />
              ),
          }}
        >
          {(data) => {
            const race = data.pages[0]?.items[0];
            return race ? (
              <SectionHero
                kicker={t(filtered ? 'races.heroKickerFiltered' : 'races.heroKicker')}
                date={formatRaceWindow(race.windowStartsAt, race.windowEndsAt, now)}
                title={race.title}
                meta={[raceHeroMeta(race, now), raceHeroLine(race, now)].filter(
                  (line): line is string => !!line,
                )}
                onPress={() => openRace(race.id)}
              />
            ) : null;
          }}
        </AsyncContent>
      </View>
    </View>
  );

  const nextPageError =
    (current.isFetchNextPageError && current.data) || (past.isFetchNextPageError && past.data);
  const pastFailed = pastEnabled && past.isError && !past.data;
  // ошибка фонового обновления «Завершённых» при показанных данных: данные остаются, баннер с повтором past
  const pastStale =
    pastEnabled && past.isError && past.data !== undefined && !past.isFetchNextPageError;
  const loadingMore =
    current.isFetchingNextPage ||
    past.isFetchingNextPage ||
    (pastEnabled && past.isPending && past.fetchStatus === 'fetching');

  const footer = (
    <View style={[styles.gutter, styles.footer]}>
      {nextPageError || pastFailed ? (
        <View style={styles.footerError}>
          <Banner
            tone="warning"
            title={t('state.failedTitle')}
            message={t('state.failedMessage')}
          />
          <TextAction
            label={t('state.retry')}
            onPress={() => {
              if (current.isFetchNextPageError) void current.fetchNextPage();
              else if (pastFailed) void past.refetch();
              else void past.fetchNextPage();
            }}
          />
        </View>
      ) : pastStale ? (
        <View style={styles.footerError}>
          <Banner tone="warning" title={t('state.staleTitle')} message={t('state.staleMessage')} />
          <TextAction label={t('state.retry')} onPress={() => void past.refetch()} />
        </View>
      ) : loadingMore ? (
        <SkeletonGroup>
          <RaceListCardSkeleton />
        </SkeletonGroup>
      ) : null}
    </View>
  );

  return (
    <FlatList
      testID="races-feed"
      data={current.data ? items : []}
      keyExtractor={(item) => item.key}
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
              {t('races.all')}
            </Text>
          ) : item.kind === 'group' ? (
            <Text style={[textStyle('label'), styles.group, { color: theme.text.secondary }]}>
              {item.title}
            </Text>
          ) : (
            <RaceListCard race={item.race} now={now} onPress={() => openRace(item.race.id)} />
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
