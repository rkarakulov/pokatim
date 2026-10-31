import type { RouteRideLeaderboard } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Kicker, TextAction } from '@rkarakulov/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { loading, RowsSkeleton, TabFailure } from '@/features/races/results-table';

import { othersTruncated, routeRideOthersPath } from './route-ride-format';
import { OthersRows } from './route-ride-others-rows';

/**
 * Блок «Другие на маршруте» карточки маршрута каталога (route-rides-04, O3): только вошедшему и только на клиенте —
 * `board: null` (гость, SSR, сессия неизвестна) — ничего; 404 (`data: null`, RC-B3) — ничего. Состояния §4.12: первая
 * загрузка — скелетон строк; ошибка без данных и пауза без сети — баннер с повтором; ошибка обновления — строки и
 * «Данные могли устареть»; пусто — текст. «Все (N)» — полный список, когда скрыт кто-то, кроме своей строки (`othersTruncated`).
 */
export function RouteRideOthersBlock({
  routeId,
  board,
  now,
}: {
  routeId: string;
  board: UseQueryResult<RouteRideLeaderboard | null> | null;
  now: Date | null;
}) {
  const router = useRouter();
  if (board === null || board.data === null) return null;
  const data = board.data;
  return (
    <View testID="route-ride-others" style={styles.block}>
      <Kicker label={t('routes.others.kicker')} />
      {data === undefined ? (
        <>
          {loading(board) ? (
            <View testID="route-ride-others-skeleton">
              <RowsSkeleton />
            </View>
          ) : null}
          <TabFailure query={board} message={t('routes.others.failed')} />
        </>
      ) : (
        <>
          {board.isError ? (
            <View style={styles.stack}>
              <Banner
                tone="warning"
                title={t('state.staleTitle')}
                message={t('state.staleMessage')}
              />
              <View style={styles.start}>
                <TextAction label={t('state.retry')} onPress={() => void board.refetch()} />
              </View>
            </View>
          ) : null}
          <OthersRows data={data} routeId={routeId} now={now} />
          {othersTruncated(data) ? (
            <View style={styles.start}>
              <TextAction
                label={t('routes.others.all', { count: data.total })}
                onPress={() => router.push(routeRideOthersPath(routeId))}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
