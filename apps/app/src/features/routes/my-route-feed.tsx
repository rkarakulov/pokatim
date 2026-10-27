import type { MyRoute } from '@pokatim/contracts';
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

import { OfflineBanner } from '@/components/offline-banner';
import { MyRouteListCard, RouteListCardSkeleton } from '@/components/route-list-card';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { MyRouteUpload } from './my-route-upload';
import { useMyRoutes } from './my-routes-queries';
import { useMyRouteUpload } from './use-my-route-upload';

const SKELETON_CARDS = [0, 1, 2];

/** Путь карточки своего маршрута. */
export const myRoutePath = (id: string) => `/routes/mine/${encodeURIComponent(id)}`;

/**
 * Лента «Мои маршруты» (routes-02, M1): шапка (заголовок и переключатель) и «Загрузить маршрут» — сразу; свои
 * маршруты новыми сверху со статусом, опрос пока есть «Обрабатывается», догрузка у конца, pull-to-refresh. Пусто —
 * «У вас пока нет маршрутов» с действием загрузки; ошибка без данных — «Нет соединения» / «Не удалось загрузить» с
 * повтором; при данных — баннер.
 */
export function MyRouteFeed({ header }: { header: ReactNode }) {
  const theme = useTheme();
  const router = useRouter();
  const { feed, loadMore } = useMyRoutes();
  const upload = useMyRouteUpload();
  const refetchers = useMemo(() => [feed.refetch], [feed.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const items: MyRoute[] = (feed.data?.pages ?? []).flatMap((page) => page.items);
  // ошибка догрузки страницы — баннер в подвале: данные остаются
  const feedState = { ...feed, isError: feed.isError && !feed.isFetchNextPageError };

  const listHeader = (
    <View style={styles.gutter}>
      {header}
      <OfflineBanner hasData={feed.data !== undefined} style={styles.offline} />
      {items.length > 0 || upload.state.phase !== 'idle' ? (
        <View style={styles.upload}>
          <MyRouteUpload upload={upload} />
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
              upload.state.phase === 'idle' ? (
                <EmptyState
                  title={t('routes.mine.empty')}
                  message={t('routes.mine.emptyHint')}
                  action={{ label: t('routes.mine.upload'), onPress: () => void upload.choose() }}
                />
              ) : null,
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
      testID="my-routes-feed"
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
          <MyRouteListCard route={item} onPress={() => router.push(myRoutePath(item.id))} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  gutter: { paddingHorizontal: size.gutter },
  offline: { marginTop: space.s2 },
  upload: { marginTop: space.s3 },
  state: { marginTop: space.s3 },
  footer: { paddingBottom: space.s6 },
  footerError: { gap: space.s3, paddingTop: space.s3 },
});
