import type { CityCode } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  Chip,
  EmptyState,
  SectionHeader,
  SegmentedControl,
  SkeletonGroup,
  SkeletonHeroCard,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { FilterGroup, FilterGroupSkeleton } from '@/components/filter-group';
import { OfflineBanner } from '@/components/offline-banner';
import { RideListRow, RideListRowSkeleton } from '@/components/ride-list-row';
import { PushSoftPrompt } from '@/features/notifications/push-soft-prompt';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import {
  groupByDay,
  hasFilters,
  NO_FILTERS,
  sortCitiesByLabel,
  toggleCity,
  withinAvailable,
  type RideFeedRow,
  type RideFilters,
} from './filters';
import { cityLabel, rideDayLabel } from './format';
import { RideRsvpAction } from './going-action';
import { distanceLabel } from './near';
import { NearEmpty } from './near-empty';
import { useRideCities, useRideFeed, useRideMap } from './queries';
import { RideHero } from './ride-hero';
import { RideMapView } from './ride-map-view';
import type { NearState } from './use-near';

export type RideFeedView = 'list' | 'map';

const VIEW_SEGMENTS = [
  { key: 'list', label: t('rides.view.list') },
  { key: 'map', label: t('rides.view.map') },
] as const;

type FeedItem = { kind: 'all' } | RideFeedRow;

const SKELETON_ROWS = [0, 1, 2];

const itemKey = (item: FeedItem) =>
  item.kind === 'all' ? 'all' : item.kind === 'day' ? `d-${item.day}` : `r-${item.ride.id}`;

/**
 * Ошибка чипов «Город» (§4.12): первая загрузка — подпись группы, текст и «Повторить» на месте ряда; ошибка обновления
 * при показанных чипах — чипы остаются, под ними текст с повтором. Лента от городов не зависит.
 */
function CitiesFailure({ stale, onRetry }: { stale: boolean; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.citiesFailure}>
      {stale ? null : (
        <Text style={[textStyle('label'), styles.citiesLabel, { color: theme.text.secondary }]}>
          {t('rides.filter.city')}
        </Text>
      )}
      <Text style={[textStyle('meta'), styles.citiesText, { color: theme.text.secondary }]}>
        {t(stale ? 'rides.error.citiesStale' : 'rides.error.citiesFailed')}
      </Text>
      <TextAction label={t('state.retry')} onPress={onRetry} />
    </View>
  );
}

export interface RideFeedProps {
  filters: RideFilters;
  onFiltersChange: (filters: RideFilters) => void;
  /** «Список» / «Карта» (05c) — состояние вкладки */
  view: RideFeedView;
  onViewChange: (view: RideFeedView) => void;
  /** «Рядом» (05c) — состояние вкладки (`useNear`) */
  near: NearState;
}

/**
 * Лента вкладки «Райды» (§3): шапка («Кофе-райды» / «Ближайшие кофе-райды» + «Создать райд») и фильтр «Город» —
 * сразу при любом состоянии данных; герой — первый райд выдачи; остальные — по дням Минска (подпись дня поперёк
 * страниц). Подгрузка у конца, подвал — скелетон строки или баннер ошибки догрузки. Пусто без фильтров —
 * приглашение создать первый райд (кнопка шапки скрыта); с фильтром — «Ничего не найдено».
 * 05c: над «Городом» — «Список / Карта» (`SegmentedControl`) и чип «Рядом»; «Рядом» — фильтр по округлённой позиции
 * (в ключе запроса — счётчик), «в N км от вас» в строках с точным стартом; отказ или ошибка чтения позиции —
 * `NearEmpty` вместо выдачи. «Карта» — `RideMapView` под той же шапкой и фильтрами.
 */
export function RideFeed({
  filters: selected,
  onFiltersChange,
  view,
  onViewChange,
  near: nearState,
}: RideFeedProps) {
  const theme = useTheme();
  const router = useRouter();
  const list = useRef<FlatList<FeedItem>>(null);
  const cities = useRideCities();
  const available = useMemo(
    () => (cities.data ? sortCitiesByLabel(cities.data.cities) : undefined),
    [cities.data],
  );
  const filters = withinAvailable(selected, available);
  const near = nearState.near;
  // отказ или ошибка чтения позиции — пустое состояние вместо выдачи (шапка и фильтры остаются)
  const locate = nearState.locate;
  const nearBlocked =
    nearState.active && (locate.status === 'denied' || locate.status === 'unavailable');
  // позиция ещё читается — скелетон, а не выдача без near под чипом «Рядом» (ревью pass 1)
  const nearPending = nearState.active && near === null && !nearBlocked;
  // запрос — только активного режима: в «Карте» near уходит лишь в запрос карты (лимит `rides-near`)
  const { feed, loadMore, stalled, scanning } = useRideFeed(
    filters,
    near,
    view === 'list' && !nearPending,
  );
  const map = useRideMap(filters, near, view === 'map' && !nearPending);
  const now = useMinskClock([feed.dataUpdatedAt]);
  const filtered = hasFilters(filters) || nearState.active;
  const me = near?.lngLat ?? null;
  const chooseCity = () => {
    nearState.off();
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const openRide = (id: string) => router.push(`/rides/${id}`);
  const create = () => router.push('/rides/new');

  const refetchers = useMemo(() => [feed.refetch, cities.refetch], [feed.refetch, cities.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const all = (feed.data?.pages ?? []).flatMap((page) => page.items);
  const rows = groupByDay(all.slice(1));
  const items: FeedItem[] = rows.length > 0 ? [{ kind: 'all' }, ...rows] : [];
  // пустая страница с курсором — не конец выдачи: пусто — только когда страниц больше нет
  const empty = feed.data !== undefined && all.length === 0 && !feed.hasNextPage;

  const feedState = { ...feed, isError: feed.isError && !feed.isFetchNextPageError };
  const resetFilters = () => {
    nearState.off();
    onFiltersChange(NO_FILTERS);
  };
  const citiesLoading = cities.isPending && cities.fetchStatus === 'fetching';

  const feedSkeleton = (
    <View style={styles.skeleton}>
      <SkeletonHeroCard />
      {SKELETON_ROWS.map((index) => (
        <RideListRowSkeleton key={index} />
      ))}
    </View>
  );

  const listHeader = (
    <View style={styles.gutter}>
      <View style={styles.head}>
        <View style={styles.headTitle}>
          <SectionHeader kicker={t('rides.kicker')} title={t('rides.title')} />
        </View>
        {empty && !filtered ? null : (
          <Button label={t('rides.create')} variant="secondary" onPress={create} />
        )}
      </View>
      <OfflineBanner
        hasData={view === 'list' ? feed.data !== undefined : map.data !== undefined}
        style={styles.offline}
      />
      <View style={styles.controls}>
        <View accessibilityLabel={t('rides.view.label')}>
          <SegmentedControl<RideFeedView>
            segments={VIEW_SEGMENTS}
            selected={view}
            onChange={onViewChange}
          />
        </View>
        <View style={styles.chips}>
          <Chip label={t('rides.near')} selected={nearState.active} onPress={nearState.toggle} />
        </View>
      </View>
      <View style={styles.filters}>
        {available === undefined ? (
          citiesLoading ? (
            <FilterGroupSkeleton label={t('rides.filter.city')} />
          ) : cities.isError ? (
            <CitiesFailure stale={false} onRetry={() => void cities.refetch()} />
          ) : null
        ) : available.length > 0 ? (
          <FilterGroup<CityCode>
            label={t('rides.filter.city')}
            options={available.map((value) => ({ value, label: cityLabel(value) ?? value }))}
            selected={filters.city}
            onToggle={(value) => onFiltersChange({ city: toggleCity(filters.city, value) })}
          />
        ) : null}
        {available !== undefined && cities.isError ? (
          <CitiesFailure stale onRetry={() => void cities.refetch()} />
        ) : null}
      </View>
      {filtered ? (
        <View style={styles.reset}>
          <TextAction label={t('rides.resetFilters')} onPress={resetFilters} />
        </View>
      ) : null}
      {view === 'map' ? null : nearPending ? (
        <View style={styles.hero}>
          <SkeletonGroup>{feedSkeleton}</SkeletonGroup>
        </View>
      ) : nearBlocked ? (
        <View style={styles.hero}>
          <NearEmpty
            canOpenSettings={locate.status === 'denied' && locate.canOpenSettings}
            onRetry={nearState.retry}
            onChooseCity={chooseCity}
          />
        </View>
      ) : (
        <View style={styles.hero}>
          <AsyncContent
            query={feedState}
            skeleton={feedSkeleton}
            empty={{
              when: () => empty,
              render: () =>
                filtered ? (
                  <EmptyState
                    title={t('rides.noMatchTitle')}
                    message={t(nearState.active ? 'rides.nearNoMatch' : 'rides.noMatch')}
                    action={{ label: t('rides.resetFilters'), onPress: resetFilters }}
                  />
                ) : (
                  <View style={styles.skeleton}>
                    <EmptyState title={t('rides.empty')} message={t('rides.emptyMessage')} />
                    <Button label={t('rides.create')} onPress={create} />
                  </View>
                ),
            }}
          >
            {() => {
              const ride = all[0];
              if (!ride) return scanning && !stalled ? feedSkeleton : null;
              return (
                <RideHero
                  ride={ride}
                  now={now}
                  kicker={t(filtered ? 'rides.heroKickerFiltered' : 'rides.heroKicker')}
                  distance={distanceLabel(me, ride.start)}
                  onPress={() => openRide(ride.id)}
                />
              );
            }}
          </AsyncContent>
        </View>
      )}
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
          <RideListRowSkeleton />
        </SkeletonGroup>
      ) : stalled ? (
        <View style={styles.reset}>
          <TextAction
            label={t('rides.more')}
            onPress={() => void feed.fetchNextPage({ cancelRefetch: false })}
          />
        </View>
      ) : null}
    </View>
  );

  if (view === 'map') {
    return (
      <View testID="rides-map-view" style={styles.mapMode}>
        {listHeader}
        {nearBlocked ? (
          <View style={[styles.gutter, styles.hero]}>
            <NearEmpty
              canOpenSettings={locate.status === 'denied' && locate.canOpenSettings}
              onRetry={nearState.retry}
              onChooseCity={chooseCity}
            />
          </View>
        ) : (
          <View style={[styles.mapMode, styles.hero]}>
            <RideMapView
              map={map}
              pending={nearPending}
              filters={filters}
              near={near}
              onOpen={openRide}
              onList={() => onViewChange('list')}
            />
          </View>
        )}
      </View>
    );
  }

  return (
    <FlatList
      ref={list}
      testID="rides-feed"
      data={feed.data && !nearBlocked && !nearPending ? items : []}
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
              {t('rides.all')}
            </Text>
          ) : item.kind === 'day' ? (
            <Text
              accessibilityRole="header"
              style={[textStyle('label'), styles.group, { color: theme.text.secondary }]}
            >
              {rideDayLabel(item.startsAt, now)}
            </Text>
          ) : (
            <>
              <RideListRow
                ride={item.ride}
                now={now}
                distance={distanceLabel(me, item.ride.start)}
                onPress={() => openRide(item.ride.id)}
                action={<RideRsvpAction ride={item.ride} variant="row" />}
              />
              {/* строка узкая для подсказки: она — под строкой, на всю ширину */}
              <PushSoftPrompt context="ride" id={item.ride.id} style={styles.softPrompt} />
            </>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  gutter: { paddingHorizontal: size.gutter },
  softPrompt: { paddingBottom: space.s3 },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s3 },
  headTitle: { flex: 1, minWidth: 0 },
  filters: { marginTop: space.s2 },
  controls: { marginTop: space.s3, gap: space.s3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  mapMode: { flex: 1 },
  offline: { marginTop: space.s2 },
  reset: { alignItems: 'flex-start' },
  hero: { marginTop: space.s3 },
  skeleton: { gap: space.s3 },
  all: { marginTop: size.sectionGap },
  group: { marginTop: space.s5, marginBottom: space.s2 },
  footer: { paddingBottom: space.s6 },
  footerError: { gap: space.s3, paddingTop: space.s3 },
  citiesFailure: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.s2,
  },
  citiesLabel: { width: '28%' },
  citiesText: { flexShrink: 1 },
});
