import { apiErrorOf } from '@pokatim/api-client';
import { RiderPublicId, type PublicRiderProfile } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, EmptyState, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { StatBlock } from '@/components/stat-block';
import { HistoryList, RaceHistoryRow } from '@/features/profile/history-rows';
import { ProfileHead, ProfileHeadSkeleton } from '@/features/profile/profile-head';
import { publicRaceRow, publicStatItems } from '@/features/profile/profile-format';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { useRider, useRiderRaces } from './queries';

/** Заголовок документа — нейтральный (D-B2): имени нет ни во вкладке, ни в истории браузера. */
const DOCUMENT_TITLE = `${t('riders.title')} — ${t('app.name')}`;

/** Тело найденного профиля: шапка, публичная статистика, «Гонки» с «Показать ещё». */
function RiderBody({
  rider,
  races,
}: {
  rider: PublicRiderProfile;
  races: ReturnType<typeof useRiderRaces>;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={styles.stack}>
      <ProfileHead name={rider.name} club={rider.club} avatarId={rider.avatar?.id ?? null} />
      <View style={[styles.padded, styles.sections]}>
        <StatBlock items={publicStatItems(rider.stats)} />
        <View style={styles.stack}>
          <Text
            accessibilityRole="header"
            style={[textStyle('displaySm'), { color: theme.text.primary }]}
          >
            {t('riders.races')}
          </Text>
          <HistoryList
            testID="rider-races"
            query={races}
            failure={t('riders.racesFailed')}
            empty={{ title: t('riders.racesEmpty') }}
            renderRow={(item) => {
              const row = publicRaceRow(item);
              return (
                <RaceHistoryRow
                  key={row.raceId}
                  row={row}
                  onPress={() => router.push(`/races/${row.raceId}`)}
                />
              );
            }}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Публичный профиль райдера (`/riders/<publicId>`, rider-profile, AC15): гость и вошедший. Данные — API через TanStack
 * Query, на web — посев SSR (`seed`). Невалидный id — «Профиль недоступен» без запроса; 404 (нет согласия, нет
 * имени, удалён — неотличимы) — то же; сеть и сервер — `AsyncContent`. «Гонки» запрашиваются только после найденного
 * профиля (без второго 404). Даты — всегда с годом: SSR совпадает с гидрацией. Без `userId`, км и райдов (их нет в
 * ответе).
 */
export function RiderScreen({ id, seed }: { id: string; seed: PublicRiderProfile | undefined }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = RiderPublicId.safeParse(id).success;
  const rider = useRider(id, seed, valid);
  const found = rider.data !== undefined && apiErrorOf(rider.error)?.code !== 'NOT_FOUND';
  const races = useRiderRaces(id, valid && found);
  const refetchers = useMemo(
    () => [rider.refetch, ...(found ? [races.refetch] : [])],
    [rider.refetch, found, races.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  // 404 — «райдер скрыл профиль», а не сбой обновления: показанные данные убираются (отзыв согласия, R-3)
  const notFound = !valid || apiErrorOf(rider.error)?.code === 'NOT_FOUND';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <DetailHeader fallback="/" />
      <OfflineBanner hasData={found && !notFound} style={styles.offline} />
      <ScrollView
        testID="rider-profile"
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
        {notFound ? (
          <View style={styles.padded}>
            <EmptyState
              title={t('riders.notFound')}
              message={t('riders.notFoundBody')}
              // вошедшему — Главная, гостю — корень (дальше решает гард)
              action={{ label: t('riders.home'), onPress: () => router.navigate('/') }}
            />
          </View>
        ) : (
          <AsyncContent query={rider} skeleton={<ProfileHeadSkeleton />}>
            {(data) => <RiderBody rider={data} races={races} />}
          </AsyncContent>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingBottom: space.s6 },
  stack: { gap: space.s3 },
  padded: { paddingHorizontal: size.gutter },
  sections: { paddingTop: size.sectionGap, gap: size.sectionGap },
  offline: { paddingHorizontal: size.gutter, paddingBottom: space.s3 },
});
