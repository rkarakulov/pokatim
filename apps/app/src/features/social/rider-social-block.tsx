import { apiErrorOf } from '@pokatim/api-client';
import type { RideCard, RiderSocial } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Banner, Button, SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { RideGoingAction } from '@/components/ride-going-action';
import { RideListRow } from '@/components/ride-list-row';
import { rememberReturnPath } from '@/features/auth/return-path';
import { riderPath } from '@/features/riders/queries';
import { rideActionErrorText, useRideRsvp } from '@/features/rides/queries';
import { useMinskClockAfterMount } from '@/lib/use-minsk-clock';

import type { useRiderSocial } from './queries';
import { riderSocialKey, socialActionErrorText, useSetRiderConnection } from './queries';
import { togetherText } from './social-format';

/** Зритель профиля: сессия неизвестна (SSR, восстановление) — `pending`. */
export type RiderSocialSession = 'signedIn' | 'guest' | 'pending';

/** «Идёт: <райд>» — строка ленты с «Я иду» / «Вы идёте»; после «Я иду» перезапрашивается состояние зрителя. */
function GoingRow({ ride, publicId, now }: { ride: RideCard; publicId: string; now: Date }) {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const rsvp = useRideRsvp(ride.id, 'profile');
  return (
    <View testID="rider-social-going">
      <Text style={[textStyle('metaXs'), { color: theme.text.secondary }]}>
        {t('social.going.kicker')}
      </Text>
      <RideListRow
        ride={ride}
        now={now}
        onPress={() => router.push(`/rides/${ride.id}`)}
        action={
          <RideGoingAction
            ride={ride}
            viewer={ride.viewer}
            variant="row"
            pending={rsvp.isPending}
            {...(rsvp.error ? { error: rideActionErrorText(rsvp.error, ride.limit) } : {})}
            onJoin={() =>
              rsvp.mutate('join', {
                onSuccess: () =>
                  void queryClient.invalidateQueries({ queryKey: riderSocialKey(publicId) }),
              })
            }
          />
        }
      />
    </View>
  );
}

/** «В свои» / «В своих» вошедшего: повтор убирает (K1, без подтверждения); отказ — текстом у кнопки. Карточка строки результата гонки (P4) — тоже. */
export function ConnectButton({ publicId, connected }: { publicId: string; connected: boolean }) {
  const mutation = useSetRiderConnection(publicId, { refreshList: true });
  return (
    <View style={styles.connect}>
      <View style={styles.start}>
        <Button
          label={t(connected ? 'social.connected' : 'social.connect')}
          variant={connected ? 'secondary' : 'primary'}
          loading={mutation.isPending}
          onPress={() => mutation.mutate(!connected)}
        />
      </View>
      {mutation.error ? (
        <Banner tone="warning" message={socialActionErrorText(mutation.error)} />
      ) : null}
    </View>
  );
}

function RiderSocialContent({ data, publicId }: { data: RiderSocial; publicId: string }) {
  const theme = useTheme();
  const now = useMinskClockAfterMount([]);
  if (data.self) return null;
  const together = togetherText(data.together, now);
  return (
    <View testID="rider-social" style={styles.block}>
      {together ? (
        <Text style={[textStyle('body'), { color: theme.text.primary }]}>{together}</Text>
      ) : null}
      {data.going ? (
        <GoingRow ride={data.going} publicId={publicId} now={now ?? new Date()} />
      ) : null}
      <ConnectButton publicId={publicId} connected={data.connected} />
    </View>
  );
}

/**
 * Блок «Свои» на чужом профиле (P3, K6): «Вместе ехали N раз · последний — дата» (N > 0), «Идёт» — ближайший райд
 * (только если зритель у райдера в «своих» — решает сервер), «В свои» / «В своих». Свой профиль — ничего. Гость —
 * только «В свои» → вход с возвратом на профиль (как «Пожаловаться»). Сессия неизвестна — ничего (без рассинхрона
 * гидрации). Состояние запроса — `AsyncContent`; 404 (профиль скрыли между запросами) — блок молчит.
 */
export function RiderSocialBlock({
  id,
  session,
  query,
}: {
  id: string;
  session: RiderSocialSession;
  query: ReturnType<typeof useRiderSocial>;
}) {
  const router = useRouter();
  if (session === 'guest') {
    const signIn = () => {
      rememberReturnPath(riderPath(id));
      router.push('/sign-in');
    };
    return (
      <View style={styles.start}>
        <Button label={t('social.connect')} onPress={signIn} />
      </View>
    );
  }
  if (session !== 'signedIn' || apiErrorOf(query.error)?.code === 'NOT_FOUND') return null;
  return (
    <AsyncContent
      query={query}
      skeleton={
        <View testID="rider-social-skeleton">
          <SkeletonText variant="body" lines={2} lastLineWidth="40%" />
        </View>
      }
    >
      {(data) => <RiderSocialContent data={data} publicId={id} />}
    </AsyncContent>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  connect: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
