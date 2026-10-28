import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type RouteRideDetail } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { formatElapsed, t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  EmptyState,
  Kicker,
  Pill,
  SkeletonHeroCard,
  SkeletonText,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { formatKm, formatMinskDateTime } from '@/features/devices/format';
import { DetailRow } from '@/features/routes/detail-row';
import { routeKm } from '@/features/routes/format';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { routeRideErrorMessage } from './error-messages';
import {
  routeRideCandidatesOptions,
  routeRidesKeys,
  useCheckRouteRide,
  useRouteRide,
} from './queries';
import { RouteRideMap } from './route-ride-map';
import {
  isPendingCheck,
  routeCardPath,
  routeRideComparisonLines,
  routeRideFailureText,
  routeRideReasonText,
  routeRideSourceLabel,
  routeRideStatusPill,
} from './route-ride-format';

/**
 * «Проверить снова» у `failed` (RC-2): в детали нет `activityId` — ищем заезд среди кандидатов (запрос — только по
 * нажатию) и проверяем его снова; нет строки — подсказка загрузить файл. Ответ — в кеш, экран остаётся (опрос).
 */
function RecheckAction({ ride, routeId }: { ride: RouteRideDetail; routeId: string }) {
  const queryClient = useQueryClient();
  const check = useCheckRouteRide(routeId);
  const [finding, setFinding] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const recheck = async () => {
    setMissing(false);
    setError(null);
    setFinding(true);
    try {
      const candidates = await queryClient.fetchQuery(routeRideCandidatesOptions(routeId));
      const candidate = candidates.items.find((item) => item.rideId === ride.id);
      if (!candidate) {
        setMissing(true);
        return;
      }
      await check.mutateAsync({ activityId: candidate.activityId });
    } catch (caught) {
      setError(caught);
    } finally {
      setFinding(false);
    }
  };
  return (
    <View style={styles.stack}>
      <Button
        label={t('routes.rides.result.recheck')}
        variant="secondary"
        loading={finding}
        onPress={() => void recheck()}
      />
      {missing ? <Banner tone="warning" message={t('routes.rides.result.recheckMissing')} /> : null}
      {error ? <Banner tone="error" message={routeRideErrorMessage(error)} /> : null}
    </View>
  );
}

/** Шапка результата по статусу: проверка идёт, пройден (время), не пройден (причина), сбой, незнакомый. */
function RideVerdict({ ride, routeId }: { ride: RouteRideDetail; routeId: string }) {
  const theme = useTheme();
  const pill = routeRideStatusPill(ride.status);
  const primary = { color: theme.text.primary };
  const statusPill = <Pill label={pill.label} tone={pill.tone} />;
  if (isPendingCheck(ride.status)) {
    return (
      <View style={styles.stack}>
        <View style={styles.pills}>{statusPill}</View>
        <Text accessibilityLiveRegion="polite" style={[textStyle('body'), primary]}>
          {t('routes.rides.result.checking')}
        </Text>
      </View>
    );
  }
  if (ride.status === 'passed') {
    return (
      <View style={styles.stack}>
        {ride.elapsedSec !== null ? (
          <Text style={[textStyle('displaySm'), primary]}>{formatElapsed(ride.elapsedSec)}</Text>
        ) : null}
        <View style={styles.pills}>
          {statusPill}
          {ride.comparison.isBest ? <Pill label={t('races.attempt.best')} tone="accent" /> : null}
        </View>
        {ride.routeDistanceM !== null ? (
          <DetailRow label={t('routes.rides.result.routeDistance')}>
            {routeKm(ride.routeDistanceM)}
          </DetailRow>
        ) : null}
      </View>
    );
  }
  if (ride.status === 'not_passed') {
    const reason = routeRideReasonText(ride.reason);
    return (
      <View style={styles.stack}>
        <View style={styles.pills}>{statusPill}</View>
        {reason ? <Text style={[textStyle('body'), primary]}>{reason}</Text> : null}
      </View>
    );
  }
  if (ride.status === 'failed') {
    return (
      <View style={styles.stack}>
        <View style={styles.pills}>{statusPill}</View>
        <Text style={[textStyle('body'), primary]}>{routeRideFailureText(ride.failure)}</Text>
        <RecheckAction ride={ride} routeId={routeId} />
      </View>
    );
  }
  return <View style={styles.pills}>{statusPill}</View>;
}

function RideView({
  ride,
  routeId,
  mine,
  now,
}: {
  ride: RouteRideDetail;
  routeId: string;
  mine: boolean;
  now: Date;
}) {
  const theme = useTheme();
  return (
    <View style={styles.detail}>
      <Kicker label={t('routes.rides.result.title')} />
      <RideVerdict ride={ride} routeId={routeId} />
      {routeRideComparisonLines(ride, now).map((line) => (
        <Text key={line} style={[textStyle('body'), { color: theme.text.primary }]}>
          {line}
        </Text>
      ))}
      <Kicker label={t('routes.rides.result.ride')} />
      <DetailRow label={t('routes.rides.result.date')}>
        {formatMinskDateTime(ride.activity.startedAt, now)}
      </DetailRow>
      <DetailRow label={t('routes.rides.result.source')}>
        {routeRideSourceLabel(ride.activity.source)}
      </DetailRow>
      <DetailRow label={t('routes.rides.result.distance')}>
        {formatKm(ride.activity.distanceM)}
      </DetailRow>
      <DetailRow label={t('routes.rides.result.elapsed')}>
        {formatElapsed(ride.activity.elapsedSec)}
      </DetailRow>
      <RouteRideMap routeId={routeId} ride={ride} mine={mine} />
    </View>
  );
}

/**
 * «Заезд по маршруту» (`/routes/rides/<routeId>/<rideId>[?mine=1]`, route-rides-02 A4) — только вошедшим, без SSR-данных
 * и OG. Статус, вердикт и время, сравнение со своими заездами (только сервер), данные заезда, карта с треком.
 * Невалидные id и 404 — «Заезд не найден» + «К маршруту»; проверка идёт — опрос (RC-6); pull-to-refresh — деталь и
 * трек.
 */
export function RouteRideScreen({
  routeId,
  rideId,
  mine,
}: {
  routeId: string;
  rideId: string;
  mine: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const valid = Uuid.safeParse(routeId).success && Uuid.safeParse(rideId).success;
  const ride = useRouteRide(routeId, rideId, valid);
  const now = useMinskClock([ride.dataUpdatedAt]);
  const refetchers = useMemo(
    () => [
      ride.refetch,
      () =>
        queryClient.refetchQueries({
          queryKey: [...routeRidesKeys.all(routeId), 'track', rideId],
          type: 'active',
        }),
    ],
    [ride.refetch, queryClient, routeId, rideId],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  const notFound = !valid || apiErrorOf(ride.error)?.code === 'NOT_FOUND';
  const title = notFound ? undefined : ride.data?.route.title;
  const card = routeCardPath(routeId, mine);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${title ?? t('routes.rides.result.title')} — ${t('app.name')}`} />
      <DetailHeader title={title} fallback={card} />
      <ScrollView
        testID="route-ride"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.text.secondary}
            colors={[theme.text.primary]}
            progressBackgroundColor={theme.surface.raised}
          />
        }
      >
        <OfflineBanner hasData={ride.data !== undefined && !notFound} style={styles.offline} />
        {notFound ? (
          <EmptyState
            title={t('routes.rides.result.notFound')}
            action={{
              label: t('routes.rides.result.toRoute'),
              onPress: () => router.navigate(card),
            }}
          />
        ) : (
          <AsyncContent
            query={ride}
            skeleton={
              <View style={styles.detail}>
                <SkeletonHeroCard />
                <SkeletonText variant="body" lines={3} lastLineWidth="60%" />
              </View>
            }
          >
            {(data) => <RideView ride={data} routeId={routeId} mine={mine} now={now} />}
          </AsyncContent>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  detail: { gap: space.s4 },
  stack: { gap: space.s3 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  offline: { paddingBottom: space.s3 },
});
