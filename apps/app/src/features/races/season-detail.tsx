import { apiErrorOf } from '@pokatim/api-client';
import { Uuid, type RaceCard, type SeasonCard, type SeasonList } from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  EmptyState,
  Pill,
  SkeletonGroup,
  SkeletonListRow,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
  type AsyncState,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { RaceListCard, RaceListCardSkeleton } from '@/components/race-list-card';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { domainLabel, formatLocalRange, heroDateText, meta } from '@/lib/minsk-format';
import { useMinskClockAfterMount } from '@/lib/use-minsk-clock';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { useSeason, useSeasonRaces, useSeasons } from './queries';

export const seasonDocumentTitle = (name: string) => `${name} — ${t('app.name')}`;

/** Даты сезона по Минску — всегда с годом (публичный экран, SSR): «1 апреля–31 октября 2026». */
export const seasonDates = (season: SeasonCard) =>
  heroDateText(formatLocalRange(season.startsOn, season.endsOn, null));

const phaseLabel = (season: SeasonCard) => domainLabel('domain.seasonPhase', season.phase);

const SKELETON_CARDS = [0, 1];

/** Шапка сезона: название, даты, метка фазы (фаза — с сервера; `'unknown'` — без метки). */
function SeasonHead({ season }: { season: SeasonCard }) {
  const theme = useTheme();
  const phase = phaseLabel(season);
  return (
    <View style={styles.head}>
      <Text
        accessibilityRole="header"
        style={[textStyle('displayTitle'), { color: theme.text.primary }]}
      >
        {season.name}
      </Text>
      <View style={styles.headMeta}>
        <Text style={[textStyle('metaLg'), { color: theme.text.secondary }]}>
          {seasonDates(season)}
        </Text>
        {phase ? (
          <Pill label={phase} tone={season.phase === 'current' ? 'accent' : 'neutral'} />
        ) : null}
      </View>
    </View>
  );
}

/**
 * «Другие сезоны» — строки (название, даты, фаза) → экран сезона. Состояния §4.12 в своём слоте: скелетон строк,
 * ошибка с повтором, ошибка обновления — строки остаются с баннером (и при пустом прежнем списке). Блок скрыт только
 * после успешного ответа без других сезонов.
 */
function OtherSeasons({
  query,
  currentId,
  onOpen,
}: {
  query: AsyncState<SeasonList>;
  currentId: string;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const others = (data: SeasonList) => data.items.filter((item) => item.id !== currentId);
  if (query.data !== undefined && !query.isError && others(query.data).length === 0) return null;
  return (
    <View testID="other-seasons" style={styles.others}>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), { color: theme.text.primary }]}
      >
        {t('season.others')}
      </Text>
      <AsyncContent
        query={query}
        skeleton={
          <View>
            <SkeletonListRow />
            <SkeletonListRow />
          </View>
        }
      >
        {(data) => <OtherSeasonRows seasons={others(data)} onOpen={onOpen} />}
      </AsyncContent>
    </View>
  );
}

function OtherSeasonRows({
  seasons,
  onOpen,
}: {
  seasons: SeasonCard[];
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  return (
    <View>
      {seasons.map((season) => {
        const phase = phaseLabel(season);
        const dates = seasonDates(season);
        return (
          <Pressable
            key={season.id}
            accessibilityRole="link"
            accessibilityLabel={[season.name, dates, phase].filter(Boolean).join('. ')}
            onPress={() => onOpen(season.id)}
            style={[styles.otherRow, { borderTopColor: theme.border.subtle }]}
          >
            <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{season.name}</Text>
            <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
              {meta([dates, phase])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Публичный экран сезона (`/seasons/<id>`, вне гардов, Q1): название, даты, фаза, гонки сезона (по концу окна,
 * курсор), «Другие сезоны». Таблицы сезона, мест и зачёта нет — модуль рейтинга (FR-4, Q2). Невалидный id и 404 —
 * «Сезон не найден»; сеть и сервер — `AsyncContent`.
 */
export function SeasonDetailScreen({ id, seed }: { id: string; seed: SeasonCard | undefined }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const signedIn = useSessionStore(isSignedIn);
  const season = useSeason(id, seed, valid);
  const races = useSeasonRaces(id, valid);
  const seasons = useSeasons(valid);
  const now = useMinskClockAfterMount([races.dataUpdatedAt]);
  const refetchers = useMemo(
    () => [season.refetch, races.refetch, seasons.refetch],
    [season.refetch, races.refetch, seasons.refetch],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);
  const notFound =
    !valid || (season.data === undefined && apiErrorOf(season.error)?.code === 'NOT_FOUND');
  // «назад» без истории и «Все гонки»: вкладки — только для вошедших, гостю — корень
  const home = signedIn ? '/races' : '/';

  const items: RaceCard[] = races.data?.pages.flatMap((page) => page.items) ?? [];
  const openSeason = (other: string) => router.push(`/seasons/${other}`);
  const racesState = { ...races, isError: races.isError && !races.isFetchNextPageError };

  const header = notFound ? (
    <EmptyState
      title={t('season.notFound')}
      action={{ label: t('races.detail.allRaces'), onPress: () => router.navigate(home) }}
    />
  ) : (
    <View>
      <OfflineBanner
        hasData={season.data !== undefined || races.data !== undefined}
        style={styles.offline}
      />
      <AsyncContent
        query={season}
        skeleton={<SkeletonText variant="displayTitle" lines={2} lastLineWidth="50%" />}
      >
        {(data) => <SeasonHead season={data} />}
      </AsyncContent>
      <Text
        accessibilityRole="header"
        style={[textStyle('displaySm'), styles.racesTitle, { color: theme.text.primary }]}
      >
        {t('season.races')}
      </Text>
      <AsyncContent
        query={racesState}
        skeleton={
          <View>
            {SKELETON_CARDS.map((index) => (
              <RaceListCardSkeleton key={index} />
            ))}
          </View>
        }
        empty={{
          when: (data) => (data.pages[0]?.items.length ?? 0) === 0,
          render: () => (
            <Text style={[textStyle('body'), styles.empty, { color: theme.text.secondary }]}>
              {t('season.racesEmpty')}
            </Text>
          ),
        }}
      >
        {() => null}
      </AsyncContent>
    </View>
  );

  const footer = notFound ? undefined : (
    <View style={styles.footer}>
      {races.isFetchNextPageError ? (
        <View style={styles.footerError}>
          <Banner
            tone="warning"
            title={t('state.failedTitle')}
            message={t('state.failedMessage')}
          />
          <TextAction label={t('state.retry')} onPress={() => void races.fetchNextPage()} />
        </View>
      ) : races.isFetchingNextPage ? (
        <SkeletonGroup>
          <RaceListCardSkeleton />
        </SkeletonGroup>
      ) : null}
      <OtherSeasons query={seasons} currentId={id} onOpen={openSeason} />
    </View>
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle
        title={seasonDocumentTitle(season.data && !notFound ? season.data.name : t('season.title'))}
      />
      {/* название — заголовком экрана ниже (displayTitle), в title bar не дублируется */}
      <DetailHeader fallback={home} />
      <FlatList
        testID="season-detail"
        data={notFound ? [] : items}
        keyExtractor={(race) => race.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        onEndReached={() => {
          if (races.hasNextPage && !races.isFetchingNextPage && !races.isFetchNextPageError) {
            void races.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.text.secondary}
            colors={[theme.text.primary]}
            progressBackgroundColor={theme.surface.raised}
          />
        }
        renderItem={({ item }) => (
          <RaceListCard
            race={item}
            now={now}
            datesWithYear
            onPress={() => router.push(`/races/${item.id}`)}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  head: { gap: space.s2 },
  offline: { paddingBottom: space.s3 },
  headMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s2 },
  racesTitle: { marginTop: size.sectionGap, marginBottom: space.s2 },
  empty: { paddingVertical: space.s3 },
  footer: { gap: space.s3 },
  footerError: { gap: space.s3, paddingTop: space.s3 },
  others: { marginTop: size.sectionGap, gap: space.s2 },
  otherRow: { borderTopWidth: stroke.hairline, paddingVertical: space.s3, gap: space.s1 },
});
