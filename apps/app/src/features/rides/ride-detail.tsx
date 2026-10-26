import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { Uuid, type RideDetail, type RideViewer } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  AvatarStack,
  Banner,
  Button,
  EmptyState,
  Kicker,
  SkeletonHeroCard,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
  type AsyncState,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { RideGoingAction } from '@/components/ride-going-action';
import { SectionHero } from '@/components/section-hero';
import { StatBlock } from '@/components/stat-block';
import { rememberReturnPath } from '@/features/auth/return-path';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { domainLabel, formatMinskDateTime } from '@/lib/minsk-format';
import { shareLink, shareOrigin } from '@/lib/share-link';
import { useMinskClockAfterMount } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import {
  cityLabel,
  goingCaption,
  organizerLine,
  paceRange,
  rideShareText,
  stackPeople,
} from './format';
import { rideActionErrorText, useRide, useRideForViewer, useRideRsvp } from './queries';

export const rideDocumentTitle = (title: string) => `${title} — ${t('app.name')}`;

const ridePath = (id: string) => `/rides/${id}`;

/** «Поделиться» ссылкой на web-карточку: share sheet / Web Share / копирование с «Ссылка скопирована». */
function ShareAction({ ride }: { ride: RideDetail }) {
  const [notice, setNotice] = useState<'copied' | 'failed' | null>(null);
  const share = () => {
    setNotice(null);
    shareLink({ title: ride.title, text: rideShareText(ride), path: ridePath(ride.id) })
      .then((outcome) => setNotice(outcome === 'copied' ? 'copied' : null))
      .catch(() => setNotice('failed'));
  };
  return (
    <View style={styles.stack}>
      <Button label={t('rides.detail.share')} variant="secondary" onPress={share} />
      {notice === 'copied' ? <Banner message={t('rides.detail.copied')} /> : null}
      {notice === 'failed' ? (
        <Banner tone="warning" message={t('rides.detail.shareFailed')} />
      ) : null}
    </View>
  );
}

/**
 * Поля и действия карточки (§3): метка «Кофе-райд» / «… · вы организатор», подпись организатора (D2), типографская
 * шапка (дата всегда с годом), «Старт: город, место», `StatBlock` дистанции и темпа, стопка, действия по `viewer`
 * сервера, баннеры отмены / прошедшего / переноса, «Об этом райде» как текст. Карты, «Набора», имён и фото нет (§4).
 * 05b: «Пожаловаться» — по `viewer.canReport`, строка «Вы пожаловались…» — по `viewer.reported`; скрытый
 * (`phase: 'hidden'`, видит только организатор) — баннер, действий нет (права сервера выключены).
 */
function RideDetailView({
  ride,
  viewer,
  signedIn,
  published,
  mounted,
}: {
  ride: RideDetail;
  /** `null` — гость; `undefined` — вошедший, состояние ещё грузится (без действия). */
  viewer: RideViewer | null | undefined;
  signedIn: boolean;
  published: boolean;
  mounted: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const rsvp = useRideRsvp(ride.id);
  const when = formatMinskDateTime(ride.startsAt, null);
  const city = cityLabel(ride.city);
  const organizer = viewer?.role === 'organizer';
  const upcoming = ride.phase === 'upcoming';
  const canShare = mounted && upcoming && shareOrigin() !== null;
  const reason = ride.cancelReason
    ? domainLabel('domain.rideCancelReason', ride.cancelReason)
    : null;

  const join = () => {
    if (!signedIn) {
      // гость: вход с возвратом к райду; запись — повторным нажатием после входа (Q13)
      rememberReturnPath(ridePath(ride.id));
      router.push('/sign-in');
      return;
    }
    rsvp.mutate('join');
  };

  return (
    <View style={styles.detail}>
      <Kicker label={t(organizer ? 'rides.detail.kickerOrganizer' : 'rides.detail.kicker')} />
      {ride.phase === 'hidden' ? (
        <Banner tone="warning" message={t('rides.detail.hidden')} />
      ) : null}
      {published && upcoming ? <Banner message={t('rides.detail.published')} /> : null}
      {ride.phase === 'cancelled' ? (
        <Banner
          tone="warning"
          message={
            reason ? t('rides.detail.cancelled', { reason }) : t('rides.detail.cancelledNoReason')
          }
        />
      ) : null}
      {ride.phase === 'past' ? (
        <Banner message={t('rides.detail.past', { date: when.date })} />
      ) : null}
      <SectionHero
        kicker={organizerLine(ride.organizerName)}
        date={{ value: when.full }}
        title={ride.title}
      />
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>
        {city
          ? t('rides.detail.start', { city, place: ride.place })
          : t('rides.detail.startPlace', { place: ride.place })}
      </Text>
      {ride.rescheduledAt ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('rides.detail.rescheduled', {
            date: formatMinskDateTime(ride.rescheduledAt, null).full,
          })}
        </Text>
      ) : null}
      <StatBlock
        items={[
          {
            value: String(ride.distanceKm),
            unit: t('rides.detail.km'),
            label: t('rides.detail.distance'),
          },
          {
            value: paceRange(ride.paceMinKmh, ride.paceMaxKmh),
            unit: t('rides.detail.kmh'),
            label: t('rides.detail.pace'),
          },
        ]}
      />
      <AvatarStack people={stackPeople(ride.goingCount)} caption={goingCaption(ride, viewer)} />
      {viewer !== undefined ? (
        <RideGoingAction
          ride={ride}
          viewer={viewer}
          variant="card"
          pending={rsvp.isPending}
          {...(rsvp.error ? { error: rideActionErrorText(rsvp.error, ride.limit) } : {})}
          goingLine={t('rides.detail.going', { date: when.date, time: when.time })}
          onJoin={join}
          onLeave={() => rsvp.mutate('leave')}
        />
      ) : null}
      {organizer && viewer?.canManage ? (
        <View style={styles.stack}>
          <Button
            label={t('rides.detail.edit')}
            variant="secondary"
            onPress={() => router.push(`/rides/edit/${ride.id}`)}
          />
          <View style={styles.start}>
            <TextAction
              label={t('rides.detail.cancel')}
              destructive
              onPress={() => router.push(`/rides/cancel/${ride.id}`)}
            />
          </View>
        </View>
      ) : null}
      {canShare ? <ShareAction ride={ride} /> : null}
      {ride.phase === 'past' ? (
        <View style={styles.start}>
          <TextAction
            label={t('rides.detail.allRides')}
            onPress={() => router.navigate(signedIn ? '/rides' : '/')}
          />
        </View>
      ) : null}
      {viewer?.reported ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('rides.detail.reported')}
        </Text>
      ) : null}
      {viewer?.canReport ? (
        <View style={styles.start}>
          <TextAction
            label={t('rides.detail.report')}
            onPress={() => router.push(`/rides/report/${ride.id}`)}
          />
        </View>
      ) : null}
      {ride.description ? (
        <View style={styles.about}>
          <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
            {t('rides.detail.about')}
          </Text>
          <Text selectable style={[textStyle('body'), { color: theme.text.primary }]}>
            {ride.description}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Публичная карточка райда (`/rides/<id>`, вне гардов: гость и вошедший). Данные — публичный `GET /v1/rides/:id`
 * (web — посев SSR); вошедшему — ещё `me` (роль и права зрителя, без кэша). Невалидный id и 404 — «Райд не найден»;
 * сеть и сервер — `AsyncContent`. `published` — баннер сразу после публикации.
 */
export function RideDetailScreen({
  id,
  seed,
  published = false,
}: {
  id: string;
  seed: RideDetail | undefined;
  published?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const signedIn = useSessionStore(isSignedIn);
  const pub = useRide(id, seed, valid);
  const me = useRideForViewer(id, valid && signedIn);
  const mounted = useMinskClockAfterMount([pub.dataUpdatedAt, me.dataUpdatedAt]) !== null;
  const refetchers = useMemo(
    () => (signedIn ? [pub.refetch, me.refetch] : [pub.refetch]),
    [signedIn, pub.refetch, me.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const ride = (signedIn ? me.data?.ride : undefined) ?? pub.data;
  const viewer = signedIn ? me.data?.viewer : null;
  // вошедшему без публичных данных — состояние `me`; иначе — публичный запрос (с посевом SSR)
  const query: AsyncState<unknown> =
    signedIn && (me.data !== undefined || pub.data === undefined) ? me : pub;
  const notFound = !valid || (ride === undefined && apiErrorOf(query.error)?.code === 'NOT_FOUND');
  const home = signedIn ? '/rides' : '/';
  // публичные данные показаны, а состояние зрителя не загрузилось: без действий — баннер с повтором (§4.12)
  const viewerFailed = signedIn && me.isError && me.data === undefined && pub.data !== undefined;

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle
        title={rideDocumentTitle(ride && !notFound ? ride.title : t('rides.detail.title'))}
      />
      <DetailHeader title={notFound ? undefined : ride?.title} fallback={home} />
      <ScrollView
        testID="ride-detail"
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
        <OfflineBanner hasData={ride !== undefined && !notFound} style={styles.offline} />
        {viewerFailed ? (
          <View style={[styles.stack, styles.offline]}>
            <Banner
              tone="warning"
              title={t(isNetworkError(me.error) ? 'state.errorTitle' : 'state.failedTitle')}
              message={t('rides.detail.viewerFailed')}
            />
            <View style={styles.start}>
              <TextAction label={t('state.retry')} onPress={() => void me.refetch()} />
            </View>
          </View>
        ) : null}
        {notFound ? (
          <EmptyState
            title={t('rides.detail.notFound')}
            action={{ label: t('rides.detail.allRides'), onPress: () => router.navigate(home) }}
          />
        ) : (
          <AsyncContent
            query={query}
            skeleton={
              <View style={styles.detail}>
                <SkeletonHeroCard />
                <SkeletonText variant="body" lines={4} lastLineWidth="60%" />
              </View>
            }
          >
            {() =>
              ride ? (
                <RideDetailView
                  ride={ride}
                  viewer={viewer}
                  signedIn={signedIn}
                  published={published}
                  mounted={mounted}
                />
              ) : null
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
  detail: { gap: space.s4 },
  offline: { paddingBottom: space.s3 },
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
  about: { gap: space.s1 },
});
