import type { CatalogRouteCard, MyRoute, RideRoute } from '@pokatim/contracts';
import { motion, size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  EmptyState,
  Pill,
  SegmentedControl,
  SkeletonGroup,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import {
  MyRouteListCard,
  RouteListCard,
  RouteListCardSkeleton,
} from '@/components/route-list-card';
import { NO_FILTERS } from '@/features/routes/filters';
import { useMyRoutes } from '@/features/routes/my-routes-queries';
import { useRouteFeed } from '@/features/routes/queries';

import { routeChoice } from './route-choice-store';

type PickTab = 'catalog' | 'mine';

const SEGMENTS = [
  { key: 'catalog', label: t('rides.routePick.catalog') },
  { key: 'mine', label: t('rides.routePick.mine') },
] as const;

const SKELETON = (
  <SkeletonGroup>
    <RouteListCardSkeleton />
    <RouteListCardSkeleton />
    <RouteListCardSkeleton />
  </SkeletonGroup>
);

const catalogChoice = (route: CatalogRouteCard): RideRoute => ({
  id: route.id,
  title: route.title,
  distanceM: route.distanceM,
  elevationGainM: route.elevationGainM,
  access: 'public',
});

/** Свой маршрут можно прикрепить: готов и с длиной (одно условие — для строк и для «пусто»). */
const pickable = (route: MyRoute) => route.status === 'ready' && route.distanceM !== null;

/** Свой маршрут виден участникам, только пока он в каталоге (одобрен). */
const publicMine = (route: MyRoute) => route.publication?.status === 'approved';

/** «Без маршрута» — первая строка обеих вкладок. */
function NoneRow({ onPick }: { onPick: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('rides.routePick.none')}
      onPress={onPick}
      style={({ pressed }) => [
        styles.none,
        { borderBottomColor: theme.border.subtle, opacity: pressed ? motion.pressedOpacity : 1 },
      ]}
    >
      <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>
        {t('rides.routePick.none')}
      </Text>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('rides.routePick.noneHint')}
      </Text>
    </Pressable>
  );
}

/** Каталог: маршруты команды и одобренные маршруты райдеров (публичные), подгрузка у конца. */
function CatalogList({
  header,
  onPick,
}: {
  header: ReactNode;
  onPick: (route: RideRoute) => void;
}) {
  const { feed, loadMore } = useRouteFeed(NO_FILTERS);
  const items = (feed.data?.pages ?? []).flatMap((page) => page.items);
  return (
    <FlatList
      testID="route-pick-catalog"
      data={items}
      keyExtractor={(route) => route.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <>
          {header}
          <AsyncContent
            query={feed}
            skeleton={SKELETON}
            empty={{
              when: (data) => (data.pages[0]?.items.length ?? 0) === 0,
              render: () => <EmptyState title={t('rides.routePick.catalogEmpty')} />,
            }}
          >
            {() => null}
          </AsyncContent>
        </>
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item }) => (
        <RouteListCard route={item} onPress={() => onPick(catalogChoice(item))} />
      )}
    />
  );
}

/** Мои: только готовые; не в каталоге — пометка «Виден только вам». Пусто — путь к загрузке в «Мои маршруты». */
function MineList({ header, onPick }: { header: ReactNode; onPick: (route: RideRoute) => void }) {
  const router = useRouter();
  const { feed, loadMore } = useMyRoutes();
  const items = (feed.data?.pages ?? []).flatMap((page) => page.items).filter(pickable);
  // страница без готовых, но с курсором — не «пусто»: дочитываем (контент не растёт, `onEndReached` не придёт)
  const scanning = feed.data !== undefined && items.length === 0 && feed.hasNextPage;
  const fetchNextPage = feed.fetchNextPage;
  const pages = feed.data?.pages.length ?? 0;
  const autoContinue = scanning && !feed.isFetching && !feed.isFetchNextPageError;
  useEffect(() => {
    if (autoContinue) void fetchNextPage({ cancelRefetch: false });
  }, [autoContinue, pages, fetchNextPage]);
  return (
    <FlatList
      testID="route-pick-mine"
      data={items}
      keyExtractor={(route) => route.id}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <>
          {header}
          <AsyncContent
            query={feed}
            skeleton={SKELETON}
            empty={{
              when: () => items.length === 0 && !feed.hasNextPage,
              render: () => (
                <EmptyState
                  title={t('rides.routePick.mineEmpty')}
                  message={t('rides.routePick.mineEmptyHint')}
                  action={{
                    label: t('rides.routePick.upload'),
                    onPress: () => router.push('/routes?view=mine'),
                  }}
                />
              ),
            }}
          >
            {() => (scanning ? SKELETON : null)}
          </AsyncContent>
        </>
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item }) => (
        <View>
          <MyRouteListCard
            route={item}
            onPress={() =>
              onPick({
                id: item.id,
                title: item.title,
                distanceM: item.distanceM ?? 0,
                elevationGainM: item.elevationGainM,
                access: publicMine(item) ? 'public' : 'private',
              })
            }
          />
          {publicMine(item) ? null : (
            <View style={styles.private}>
              <Pill label={t('rides.route.private')} />
            </View>
          )}
        </View>
      )}
    />
  );
}

/**
 * Выбор маршрута райда (`/rides/route-pick?form=new|<rideId>`, 05c, только вошедшим): «Каталог» / «Мои»
 * (`SegmentedControl`, поиск не нужен), сверху — «Без маршрута». Нажатие — выбор в `routeChoice` для своей формы и
 * назад (без истории — замена на форму). Свой непубличный маршрут прикрепить можно (участники увидят карту после
 * одобрения) — помечен «Виден только вам». Право прикрепить проверяет сервер (`RIDE_ROUTE_UNAVAILABLE`).
 */
export function RideRoutePickScreen({ form }: { form: string }) {
  const theme = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<PickTab>('catalog');
  const title = t('rides.routePick.title');
  const formPath = form === 'new' ? '/rides/new' : `/rides/edit/${encodeURIComponent(form)}`;

  const pick = (route: RideRoute | null) => {
    routeChoice.set({ form, route });
    if (router.canGoBack()) router.back();
    else router.replace(formPath);
  };
  const header = (
    <View style={styles.header}>
      <View accessibilityLabel={t('rides.routePick.switch')}>
        <SegmentedControl<PickTab> segments={SEGMENTS} selected={tab} onChange={setTab} />
      </View>
      <NoneRow onPick={() => pick(null)} />
    </View>
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${title} — ${t('app.name')}`} />
      <DetailHeader title={title} fallback={formPath} />
      {tab === 'catalog' ? (
        <CatalogList header={header} onPick={pick} />
      ) : (
        <MineList header={header} onPick={pick} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  header: { gap: space.s3, paddingBottom: space.s3 },
  none: { gap: space.s1, paddingVertical: space.s3, borderBottomWidth: stroke.hairline },
  private: { alignItems: 'flex-start', paddingBottom: space.s3 },
});
