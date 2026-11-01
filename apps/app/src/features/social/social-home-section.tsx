import type {
  SocialHome,
  SocialHomeResultRow,
  SocialHomeRideRow,
  SocialHomeRouteRow,
} from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { formatPlace, t } from '@pokatim/i18n';
import { SectionHeader, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GoingStack } from '@/components/going-stack';
import { RideGoingAction } from '@/components/ride-going-action';
import { RideListRow } from '@/components/ride-list-row';
import { RouteListCard } from '@/components/route-list-card';
import { rideActionErrorText, useRideRsvp } from '@/features/rides/queries';

import { socialHomeKey } from './queries';
import { deltaText, goingText, resultText } from './social-home-format';

/** «Катя Л. и ещё 2 идут» + строка ленты; «Я иду» — источник `social_home` (K12), после — секция перезапрашивается. */
export function SocialRideRow({ row, now }: { row: SocialHomeRideRow; now: Date }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const rsvp = useRideRsvp(row.ride.id, 'social_home');
  const going = goingText(row);
  return (
    <View
      testID="social-home-ride"
      accessibilityLabel={t('social.home.a11yRide', { going, ride: row.ride.title })}
    >
      <GoingStack
        count={row.riders.length + row.othersCount}
        caption={going}
        avatarIds={row.riders.map((rider) => rider.avatar?.id ?? null)}
      />
      <RideListRow
        ride={row.ride}
        now={now}
        onPress={() => router.push(`/rides/${row.ride.id}`)}
        action={
          <RideGoingAction
            ride={row.ride}
            viewer={row.ride.viewer}
            variant="row"
            pending={rsvp.isPending}
            {...(rsvp.error ? { error: rideActionErrorText(rsvp.error, row.ride.limit) } : {})}
            onJoin={() =>
              rsvp.mutate('join', {
                onSuccess: () => void queryClient.invalidateQueries({ queryKey: socialHomeKey }),
              })
            }
          />
        }
      />
    </View>
  );
}

/** «Андрей К. · 1:59:40», гонка и место, разница со зрителем — переход на карточку результата. */
export function SocialResultRow({ row }: { row: SocialHomeResultRow }) {
  const theme = useTheme();
  const router = useRouter();
  const title = resultText(row);
  const place = formatPlace(row.place, row.tied);
  const delta = deltaText(row.deltaSec);
  return (
    <Pressable
      testID="social-home-result"
      accessibilityRole="link"
      accessibilityLabel={[
        t('social.home.a11yResult', {
          name: row.rider.name,
          race: row.race.title,
          place,
          time: title,
        }),
        delta,
      ]
        .filter(Boolean)
        .join('. ')}
      onPress={() => router.push(`/races/result/${row.race.id}/${row.entryId}` as Href)}
      style={[styles.row, { borderTopColor: theme.border.subtle }]}
    >
      <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{title}</Text>
      <Text style={[textStyle('meta'), styles.line, { color: theme.text.secondary }]}>
        {`${row.race.title} · ${place}`}
      </Text>
      {delta ? (
        <Text style={[textStyle('meta'), styles.line, { color: theme.text.secondary }]}>
          {delta}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** «Новый маршрут от Сергея К.» + карточка каталога. */
export function SocialRouteRow({ row }: { row: SocialHomeRouteRow }) {
  const theme = useTheme();
  const router = useRouter();
  const kicker = t('social.home.route', { name: row.rider.name });
  return (
    <View
      testID="social-home-route"
      style={styles.route}
      accessibilityLabel={t('social.home.a11yRoute', {
        name: row.rider.name,
        route: row.route.title,
      })}
    >
      <Text style={[textStyle('metaXs'), { color: theme.text.secondary }]}>{kicker}</Text>
      <RouteListCard route={row.route} onPress={() => router.push(`/routes/${row.route.id}`)} />
    </View>
  );
}

/**
 * Секция «Свои» на Главной (K7, social-p7): только при строках сервера (≤ 3, порядок сервера). Первой загрузки и
 * ошибки без данных — секции нет (исключение §4.12 по прецеденту «Ваших билетов», RC-P7-17); ошибка обновления при
 * показанных данных — данные остаются. «Все свои» → экран «Свои».
 */
export function SocialHomeSection({
  data,
  now,
  first,
}: {
  data: SocialHome | undefined;
  now: Date;
  /** первый блок ленты — без линии сверху */
  first: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <View
      testID="social-home"
      style={[
        styles.section,
        first ? styles.first : { borderTopColor: theme.border.subtle, ...styles.divided },
      ]}
    >
      <SectionHeader kicker={t('social.home.kicker')} title={t('social.home.title')} />
      {items.map((row) =>
        row.kind === 'ride' ? (
          <SocialRideRow key={`ride:${row.ride.id}`} row={row} now={now} />
        ) : row.kind === 'result' ? (
          <SocialResultRow key={`result:${row.entryId}`} row={row} />
        ) : (
          <SocialRouteRow key={`route:${row.route.id}`} row={row} />
        ),
      )}
      <View style={styles.all}>
        <TextAction label={t('social.home.all')} onPress={() => router.navigate('/social')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: size.gutter, paddingTop: size.sectionGap },
  first: { paddingTop: space.s2 },
  divided: { borderTopWidth: stroke.hairline },
  row: { minHeight: size.rowMin, paddingVertical: space.s4, borderTopWidth: stroke.hairline },
  line: { marginTop: space.s1 },
  route: { paddingVertical: space.s3, gap: space.s2 },
  all: { paddingVertical: space.s3, alignItems: 'flex-start' },
});
