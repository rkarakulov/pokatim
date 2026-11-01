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
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { actionErrorMessage } from '@/features/auth/error-messages';
import { formatKm, formatMinskDateTime } from '@/features/devices/format';
import { DetailRow } from '@/features/routes/detail-row';
import { RouteAuthorRespect } from '@/features/social/respect-block';
import { routeKm } from '@/features/routes/format';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { routeRideErrorMessage } from './error-messages';
import {
  forgetRouteRide,
  routeRidesKeys,
  useCheckRouteRide,
  useDeleteRouteRide,
  useRouteRide,
} from './queries';
import { RouteRideMap } from './route-ride-map';
import {
  isPendingCheck,
  routeCardPath,
  routeRideComparisonLines,
  routeRideFailureText,
  routeRideOriginText,
  routeRideReasonText,
  routeRideSectionsShown,
  routeRideSourceLabel,
  routeRideStatusPill,
} from './route-ride-format';
import { RouteRideSections } from './route-ride-sections';

/**
 * «Проверить снова» у `failed` (route-rides-03): `POST { activityId }` своей основной из детали (без запроса
 * кандидатов); `404` — активности больше нет, подсказка загрузить файл. Старый API без `activityId` — кнопки нет.
 * Ответ — в кеш, экран остаётся (опрос).
 */
function RecheckAction({ activityId, routeId }: { activityId: string; routeId: string }) {
  const check = useCheckRouteRide(routeId);
  const [error, setError] = useState<unknown>(null);
  const recheck = async () => {
    setError(null);
    try {
      await check.mutateAsync({ activityId });
    } catch (caught) {
      setError(caught);
    }
  };
  const missing = apiErrorOf(error)?.code === 'NOT_FOUND';
  return (
    <View style={styles.stack}>
      <Button
        label={t('routes.rides.result.recheck')}
        variant="secondary"
        loading={check.isPending}
        onPress={() => void recheck()}
      />
      {missing ? <Banner tone="warning" message={t('routes.rides.result.recheckMissing')} /> : null}
      {error && !missing ? <Banner tone="error" message={routeRideErrorMessage(error)} /> : null}
    </View>
  );
}

/**
 * «Удалить заезд» с подтверждением (route-rides-07, `[ASSUMPTION]` тексты и место — внизу экрана, как «Удалить» у
 * «Моего маршрута»). Успех — к карточке маршрута (`dismissTo`: карточка в стеке — снять экраны над ней, в том числе
 * «Другие»; нет — заменить), она уже обновлена инвалидацией.
 */
function DeleteRideAction({
  routeId,
  rideId,
  card,
}: {
  routeId: string;
  rideId: string;
  card: Href;
}) {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const remove = useDeleteRouteRide(routeId, rideId);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <View style={styles.action}>
        <TextAction
          label={t('routes.rides.result.delete')}
          destructive
          onPress={() => setConfirming(true)}
        />
      </View>
    );
  }
  const confirm = async () => {
    try {
      await remove.mutateAsync();
    } catch {
      return; // текст отказа — из `remove.error`
    }
    router.dismissTo(card);
    forgetRouteRide(queryClient, routeId, rideId);
  };
  return (
    <View style={styles.stack}>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>
        {t('routes.rides.result.deleteConfirm')}
      </Text>
      {remove.isError ? (
        <Banner
          tone="error"
          title={t('routes.rides.result.deleteFailed')}
          message={actionErrorMessage(remove.error)}
        />
      ) : null}
      <Button
        label={t('routes.rides.result.delete')}
        onPress={() => void confirm()}
        loading={remove.isPending}
      />
      <View style={styles.action}>
        <TextAction
          label={t('routes.rides.result.deleteCancel')}
          onPress={() => {
            setConfirming(false);
            remove.reset();
          }}
          disabled={remove.isPending}
        />
      </View>
    </View>
  );
}

/** «Проверен автоматически» у заезда автопроверки (V5); ручной — ничего. */
function OriginNote({ ride }: { ride: RouteRideDetail }) {
  const theme = useTheme();
  const text = routeRideOriginText(ride.origin);
  if (!text) return null;
  return <Text style={[textStyle('body'), { color: theme.text.secondary }]}>{text}</Text>;
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
        {ride.activityId !== null ? (
          <RecheckAction activityId={ride.activityId} routeId={routeId} />
        ) : null}
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
      {/* «Респект автору» (P4, K8): после «Маршрут пройден», не на своём маршруте; команды — сервер не даст */}
      {ride.status === 'passed' && !mine ? <RouteAuthorRespect routeId={routeId} /> : null}
      <OriginNote ride={ride} />
      {routeRideComparisonLines(ride, now).map((line) => (
        <Text key={line} style={[textStyle('body'), { color: theme.text.primary }]}>
          {line}
        </Text>
      ))}
      {routeRideSectionsShown(ride) ? <RouteRideSections sections={ride.sections} /> : null}
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
      <DeleteRideAction routeId={routeId} rideId={ride.id} card={routeCardPath(routeId, mine)} />
    </View>
  );
}

/**
 * «Заезд по маршруту» (`/routes/rides/<routeId>/<rideId>[?mine=1]`, route-rides-02 A4) — только вошедшим, без SSR-данных
 * и OG. Статус, вердикт и время, сравнение со своими заездами (только сервер), участки (route-rides-05), данные
 * заезда, карта с треком.
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
  action: { alignItems: 'flex-start' },
  offline: { paddingBottom: space.s3 },
});
