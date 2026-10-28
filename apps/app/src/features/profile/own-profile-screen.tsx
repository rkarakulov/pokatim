import type { ProfileView } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { useHeaderSeasonState } from '@/features/races/queries';
import { ProfileSeasonBlock } from '@/features/standings/profile-season-block';
import { useStandingsRefetch } from '@/features/standings/queries';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { ProfileHead, ProfileHeadSkeleton } from './profile-head';
import { ProfileHistory, type HistoryTab } from './profile-history';
import { ProfileStats } from './profile-stats';
import { useProfile, useProfileRaces, useProfileRides, useProfileStats } from './queries';

const DOCUMENT_TITLE = `${t('profile.title')} — ${t('app.name')}`;

/** «Редактировать профиль» и «Как вас видят другие» (или подсказка, пока ссылки нет). */
function ProfileActions({ profile }: { profile: ProfileView }) {
  const theme = useTheme();
  const router = useRouter();
  const publicId = profile.publicId;
  return (
    <View style={styles.actions}>
      <TextAction label={t('profile.edit')} onPress={() => router.push('/settings/profile')} />
      {publicId !== null ? (
        <TextAction
          label={t('profile.publicLink')}
          onPress={() => router.push(`/riders/${encodeURIComponent(publicId)}`)}
        />
      ) : (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('profile.publicHint')}
        </Text>
      )}
    </View>
  );
}

/**
 * Свой профиль (`/profile`, rider-profile, AC12–AC13; вход — аватар верхней панели Главной): шапка с аватаром, именем
 * и клубом, «Редактировать профиль», «Как вас видят другие», статистика, блок «Сезон», «История». Каждый блок —
 * свои состояния §4.12; заголовок и навигация — сразу. Обновление — pull-to-refresh и фокус (`focusManager`).
 */
export function OwnProfileScreen() {
  const theme = useTheme();
  const profile = useProfile();
  const stats = useProfileStats();
  const [tab, setTab] = useState<HistoryTab>('races');
  // запрос — только у выбранной вкладки: «Райды» — с первого переключения, загруженное остаётся в кэше
  const races = useProfileRaces(tab === 'races');
  const rides = useProfileRides(tab === 'rides');
  const { season } = useHeaderSeasonState();
  const refetchStandings = useStandingsRefetch(season?.id ?? '');
  const hasSeason = season !== null;
  const refetchers = useMemo(
    () => [
      profile.refetch,
      stats.refetch,
      tab === 'races' ? races.refetch : rides.refetch,
      ...(hasSeason ? [refetchStandings] : []),
    ],
    [
      profile.refetch,
      stats.refetch,
      tab,
      races.refetch,
      rides.refetch,
      hasSeason,
      refetchStandings,
    ],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <DetailHeader fallback="/" />
      <ScrollView
        testID="own-profile"
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
        <AsyncContent query={profile} skeleton={<ProfileHeadSkeleton />}>
          {(data) => (
            <View style={styles.stack}>
              <ProfileHead
                name={data.publicName}
                club={data.club}
                avatarId={data.avatar?.id ?? null}
              />
              <View style={styles.padded}>
                <ProfileActions profile={data} />
              </View>
            </View>
          )}
        </AsyncContent>
        <View style={[styles.padded, styles.sections]}>
          <ProfileStats query={stats} />
          {/* блок «Сезон» (race-results-08c): своих строк нет — блока нет */}
          <ProfileSeasonBlock />
          <ProfileHistory tab={tab} onTabChange={setTab} races={races} rides={rides} />
          {/* rider-profile: здесь — «Эмаль» достижений, следующая задача */}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingBottom: space.s6 },
  stack: { gap: space.s3 },
  padded: { paddingHorizontal: size.gutter },
  actions: { alignItems: 'flex-start', gap: space.s2 },
  sections: { paddingTop: size.sectionGap, gap: size.sectionGap },
});
