import type { CatalogRouteCard, CityCode } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  EmptyState,
  SkeletonGroup,
  TextAction,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { FilterGroup, FilterGroupSkeleton } from '@/components/filter-group';
import { OfflineBanner } from '@/components/offline-banner';
import { RouteListCard, RouteListCardSkeleton } from '@/components/route-list-card';
import { sortCitiesByLabel } from '@/features/rides/filters';
import { cityLabel } from '@/features/rides/format';
import { toggle } from '@/lib/filter-chips';
import { domainLabel } from '@/lib/minsk-format';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import {
  AUTHOR_CHIPS,
  DISTANCE_CHIPS,
  hasFilters,
  NO_FILTERS,
  SURFACE_CHIPS,
  withinAvailable,
  type RouteFilters,
} from './filters';
import { useRouteCities, useRouteFeed } from './queries';

const SKELETON_CARDS = [0, 1, 2];

export interface RouteFeedProps {
  /** Шапка вкладки (заголовок) — видна при любом состоянии данных. */
  header: ReactNode;
  filters: RouteFilters;
  onFiltersChange: (filters: RouteFilters) => void;
}

/**
 * Лента вкладки «Маршруты» (routes-01, D3): шапка и фильтры — сразу; список карточек каталога (новые публикации
 * сверху), подгрузка у конца (`FlatList.onEndReached`), в подвале — скелетон карточки или баннер ошибки догрузки с
 * повтором (загруженное остаётся). Чипы «Город» — из `GET /v1/routes/cities` (до ответа — скелетон группы, ошибка или
 * пусто — группа скрыта, исчезнувший город снимается). Смена фильтра — новый ключ: скелетон на месте данных.
 */
export function RouteFeed({ header, filters: selected, onFiltersChange }: RouteFeedProps) {
  const theme = useTheme();
  const router = useRouter();
  const cities = useRouteCities();
  const cityChips = useMemo(
    () => (cities.data ? sortCitiesByLabel(cities.data.cities) : undefined),
    [cities.data],
  );
  const filters = withinAvailable(selected, cities.data?.cities);
  const { feed, loadMore } = useRouteFeed(filters);
  const filtered = hasFilters(filters);
  const openRoute = (id: string) => router.push(`/routes/${id}`);

  const refetchers = useMemo(() => [feed.refetch, cities.refetch], [feed.refetch, cities.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const items: CatalogRouteCard[] = (feed.data?.pages ?? []).flatMap((page) => page.items);
  // ошибка догрузки страницы — баннер в подвале: данные остаются
  const feedState = { ...feed, isError: feed.isError && !feed.isFetchNextPageError };
  const resetFilters = () => onFiltersChange(NO_FILTERS);
  // офлайн-старт: запрос чипов на паузе — группа скрыта, а не вечный скелетон
  const citiesLoading = cities.isPending && cities.fetchStatus === 'fetching';
  const cityLabelText = t('routes.filter.city');

  const listHeader = (
    <View style={styles.gutter}>
      {header}
      <OfflineBanner hasData={feed.data !== undefined} style={styles.offline} />
      <View style={styles.filters}>
        {cityChips === undefined ? (
          citiesLoading ? (
            <FilterGroupSkeleton label={cityLabelText} />
          ) : null
        ) : cityChips.length > 0 ? (
          <FilterGroup<CityCode>
            label={cityLabelText}
            options={cityChips.map((value) => ({ value, label: cityLabel(value) ?? value }))}
            selected={filters.city}
            onToggle={(value) => onFiltersChange({ ...filters, city: toggle(filters.city, value) })}
          />
        ) : null}
        <FilterGroup
          label={t('routes.filter.distance')}
          options={DISTANCE_CHIPS.map((value) => ({ value, label: t(`routes.distance.${value}`) }))}
          selected={filters.distance}
          onToggle={(value) =>
            onFiltersChange({ ...filters, distance: toggle(filters.distance, value) })
          }
        />
        <FilterGroup
          label={t('routes.filter.surface')}
          options={SURFACE_CHIPS.map((value) => ({
            value,
            label: domainLabel('domain.surface', value) ?? value,
          }))}
          selected={filters.surface}
          onToggle={(value) =>
            onFiltersChange({ ...filters, surface: toggle(filters.surface, value) })
          }
        />
        <FilterGroup
          label={t('routes.filter.author')}
          options={AUTHOR_CHIPS.map((value) => ({
            value,
            label: t(`routes.filter.author.${value}`),
          }))}
          selected={filters.author}
          onToggle={(value) =>
            onFiltersChange({ ...filters, author: toggle(filters.author, value) })
          }
        />
      </View>
      {filtered ? (
        <View style={styles.reset}>
          <TextAction label={t('routes.resetFilters')} onPress={resetFilters} />
        </View>
      ) : null}
      <View style={styles.state}>
        <AsyncContent
          query={feedState}
          skeleton={
            <View>
              {SKELETON_CARDS.map((index) => (
                <RouteListCardSkeleton key={index} />
              ))}
            </View>
          }
          empty={{
            when: (data) => (data.pages[0]?.items.length ?? 0) === 0,
            render: () =>
              filtered ? (
                <EmptyState
                  title={t('routes.noMatchTitle')}
                  message={t('routes.noMatch')}
                  action={{ label: t('routes.resetFilters'), onPress: resetFilters }}
                />
              ) : (
                <EmptyState title={t('routes.empty')} />
              ),
          }}
        >
          {/* карточки — строки FlatList ниже */}
          {() => null}
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
          <RouteListCardSkeleton />
        </SkeletonGroup>
      ) : null}
    </View>
  );

  return (
    <FlatList
      testID="routes-feed"
      data={feed.data ? items : []}
      keyExtractor={(route) => route.id}
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
          <RouteListCard route={item} onPress={() => openRoute(item.id)} />
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
  state: { marginTop: space.s3 },
  footer: { paddingBottom: space.s6 },
  footerError: { gap: space.s3, paddingTop: space.s3 },
});
