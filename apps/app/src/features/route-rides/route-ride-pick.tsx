import { Uuid, type RouteRideCandidate } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { formatElapsed, t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  EmptyState,
  SkeletonGroup,
  SkeletonListRow,
  TextAction,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityPickRow } from '@/components/activity-pick-row';
import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { formatKm, formatMinskDateTime } from '@/features/devices/format';
import { UploadProgress } from '@/features/devices/upload-progress';
import { meta } from '@/lib/minsk-format';
import { useMinskClock } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { routeRideErrorMessage } from './error-messages';
import { useCheckRouteRide, useRouteRideCandidates } from './queries';
import { routeCardPath, routeRidePath, routeRideSourceLabel } from './route-ride-format';
import { useRouteRideUpload } from './use-route-ride-upload';

function CandidateRow({
  candidate,
  now,
  busy,
  onPick,
}: {
  candidate: RouteRideCandidate;
  now: Date;
  busy: boolean;
  onPick: () => void;
}) {
  const when = formatMinskDateTime(candidate.startedAt, now);
  const details = meta([
    routeRideSourceLabel(candidate.source),
    formatKm(candidate.distanceM),
    formatElapsed(candidate.elapsedSec),
  ]);
  const note = candidate.rideId ? t('routes.rides.pick.checked') : null;
  return (
    <ActivityPickRow
      title={when}
      details={details}
      note={note}
      busy={busy}
      onPress={onPick}
      accessibilityLabel={meta([when, details, note])}
    />
  );
}

/**
 * «Выбрать свой заезд» для маршрута (`/routes/pick/<routeId>[?mine=1]`, route-rides-02 A3) — только вошедшим.
 * Кандидаты сервера; уже проверенный — к его результату без POST; выбор — POST `{ activityId }` и `replace` на
 * результат. «Загрузить заезд» — файл → опрос готовности → POST `{ uploadId }` (RC-1). Невалидный id — «Маршрут
 * недоступен» без запроса.
 */
export function RouteRidePickScreen({ routeId, mine }: { routeId: string; mine: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(routeId).success;
  const candidates = useRouteRideCandidates(routeId, valid);
  const check = useCheckRouteRide(routeId);
  const now = useMinskClock([candidates.dataUpdatedAt]);
  const title = t('routes.rides.pick.title');
  const card = routeCardPath(routeId, mine);
  const toResult = (rideId: string) => router.replace(routeRidePath(routeId, rideId, mine));
  const upload = useRouteRideUpload(routeId, { onChecked: (ride) => toResult(ride.id) });
  const busy = check.isPending || upload.busy;
  const refetchers = useMemo(() => [candidates.refetch], [candidates.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const pick = (candidate: RouteRideCandidate) => {
    if (candidate.rideId) {
      toResult(candidate.rideId);
      return;
    }
    check.mutate({ activityId: candidate.activityId }, { onSuccess: (ride) => toResult(ride.id) });
  };
  const chooseFile = () => {
    check.reset();
    upload.choose();
  };
  const { state } = upload;

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${title} — ${t('app.name')}`} />
      <DetailHeader title={title} fallback={card} />
      <ScrollView
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
        {valid ? (
          <View style={styles.list}>
            {state.phase === 'uploading' ? (
              <UploadProgress
                name={state.name}
                progress={state.progress}
                onCancel={upload.cancel}
              />
            ) : null}
            {state.phase === 'processing' || state.phase === 'checking' ? (
              <View accessibilityLiveRegion="polite">
                <Banner message={t('routes.rides.pick.processing')} />
              </View>
            ) : null}
            {state.phase === 'timeout' ? (
              <Banner tone="warning" message={t('routes.rides.error.ROUTE_RIDE_NOT_READY')} />
            ) : null}
            {state.phase === 'failed' ? <Banner tone="error" message={state.message} /> : null}
            {check.error ? (
              <Banner tone="error" message={routeRideErrorMessage(check.error)} />
            ) : null}
            <AsyncContent
              query={candidates}
              skeleton={
                <SkeletonGroup>
                  <SkeletonListRow />
                  <SkeletonListRow />
                  <SkeletonListRow />
                </SkeletonGroup>
              }
              empty={{
                when: (data) => data.items.length === 0,
                render: () => (
                  <EmptyState
                    title={t('routes.rides.pick.empty')}
                    message={t('routes.rides.pick.emptyHint')}
                    {...(busy
                      ? {}
                      : { action: { label: t('routes.rides.pick.upload'), onPress: chooseFile } })}
                  />
                ),
              }}
            >
              {(data) => (
                <View>
                  {busy ? null : (
                    <View style={styles.upload}>
                      <TextAction label={t('routes.rides.pick.upload')} onPress={chooseFile} />
                    </View>
                  )}
                  {data.items.map((candidate) => (
                    <CandidateRow
                      key={candidate.activityId}
                      candidate={candidate}
                      now={now}
                      busy={busy}
                      onPick={() => pick(candidate)}
                    />
                  ))}
                </View>
              )}
            </AsyncContent>
          </View>
        ) : (
          <EmptyState
            title={t('routes.detail.notFound')}
            action={{
              label: t('routes.detail.allRoutes'),
              onPress: () => router.navigate('/routes'),
            }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  list: { gap: space.s3 },
  upload: { alignItems: 'flex-start', paddingBottom: space.s3 },
});
