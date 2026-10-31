import { ROUTE_RIDE_LEADERBOARD_MAX, Uuid } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, EmptyState, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { RowsSkeleton } from '@/features/races/results-table';
import { useMinskClockAfterMount } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { useRouteRideLeaderboard } from './queries';
import { othersTruncated, routeCardPath } from './route-ride-format';
import { OthersRows } from './route-ride-others-rows';

/**
 * Полный список «Другие на маршруте» (`/routes/others/<routeId>`, route-rides-04) — только вошедшим: до
 * `ROUTE_RIDE_LEADERBOARD_MAX` строк сервера, своя вне списка — отдельно, сноска, если сервер отдал не всех. Невалидный
 * id — «Маршрут недоступен» без запроса; 404 — то же. Состояния — `AsyncContent`; обновление — pull-to-refresh.
 * Заголовок документа — без имён.
 */
export function RouteRideOthersScreen({ routeId }: { routeId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(routeId).success;
  const board = useRouteRideLeaderboard(routeId, ROUTE_RIDE_LEADERBOARD_MAX, valid);
  const now = useMinskClockAfterMount([board.dataUpdatedAt]);
  const title = t('routes.others.title');
  const gone = !valid || board.data === null;
  const refetchers = useMemo(() => [board.refetch], [board.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${title} — ${t('app.name')}`} />
      <DetailHeader title={title} fallback={routeCardPath(routeId, false)} />
      <ScrollView
        testID="route-ride-others-screen"
        contentContainerStyle={styles.content}
        refreshControl={
          valid ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={theme.text.secondary}
              colors={[theme.text.primary]}
              progressBackgroundColor={theme.surface.raised}
            />
          ) : undefined
        }
      >
        {gone ? (
          <EmptyState
            title={t('routes.detail.notFound')}
            action={{
              label: t('routes.detail.allRoutes'),
              onPress: () => router.navigate('/routes'),
            }}
          />
        ) : (
          <AsyncContent
            query={board}
            skeleton={
              <View testID="route-ride-others-skeleton">
                <RowsSkeleton />
              </View>
            }
          >
            {(data) =>
              data === null ? null : (
                <View style={styles.list}>
                  <OthersRows data={data} routeId={routeId} now={now} />
                  {othersTruncated(data) ? (
                    <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
                      {t('routes.others.truncated', {
                        shown: data.rows.length,
                        count: data.total,
                      })}
                    </Text>
                  ) : null}
                </View>
              )
            }
          </AsyncContent>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  list: { gap: space.s3 },
});
