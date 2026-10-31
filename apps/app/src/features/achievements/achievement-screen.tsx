import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Button, EmptyState, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { storyPath } from '@/features/races/story/paths';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import {
  achievementKey,
  achievementTitle,
  catalogEntry,
  knownItems,
  seasonOf,
  shareRaceId,
} from './achievement-catalog';
import { AchievementCard, AchievementCardSkeleton } from './achievement-card';
import { useAchievements } from './queries';
import { achievementStoryPath } from './story/achievement-story';

const DOCUMENT_TITLE = `${t('achievements.title')} — ${t('app.name')}`;

/**
 * Экран своего достижения (`/achievements/<code>`, сезонное — `?season=<id>`; A5–A6, S7): тот же макет, что вспышка,
 * без «Дальше»; вход — плитка блока «Достижения» в `/profile`. «Поделиться» — карточка достижения (у сезонных — с
 * сезоном, C1), у гоночных ещё «Сторис результата», у сезонных — «К сезону». Данные — тот же кэш `['achievements']`, поиск — по
 * `achievementKey`. Нет в списке (отозвано, незнакомый адрес) — пустое состояние с переходом в профиль. Экран `seen` не
 * шлёт: вспышку показывает только хост.
 */
export function AchievementScreen({ code, season }: { code: string; season?: string | null }) {
  const theme = useTheme();
  const router = useRouter();
  const query = useAchievements();
  const { refreshing, onRefresh } = usePullToRefresh([query.refetch]);
  const wanted = season ? `${code}:${season}` : code;
  const item = query.data
    ? knownItems(query.data.items).find((a) => achievementKey(a) === wanted)
    : undefined;

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle
        title={item ? `${achievementTitle(item.code)} — ${t('app.name')}` : DOCUMENT_TITLE}
      />
      <DetailHeader fallback="/profile" />
      <ScrollView
        testID="achievement-screen"
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
        <AsyncContent query={query} skeleton={<AchievementCardSkeleton />}>
          {() => {
            if (!item) {
              return (
                <EmptyState
                  title={t('achievements.notFound')}
                  message={t('achievements.notFoundBody')}
                  action={{
                    label: t('achievements.toProfile'),
                    onPress: () => router.navigate('/profile'),
                  }}
                />
              );
            }
            const raceId = shareRaceId(item);
            const seasonId = seasonOf(item);
            return (
              <AchievementCard item={item}>
                {catalogEntry(item.code).storyCard ? (
                  <Button
                    label={t('achievements.share')}
                    onPress={() => router.push(achievementStoryPath(item.code, seasonId))}
                  />
                ) : null}
                {seasonId !== null ? (
                  <Button
                    label={t('achievements.toSeason')}
                    onPress={() => router.push(`/seasons/${seasonId}`)}
                  />
                ) : null}
                {raceId !== null ? (
                  <Button
                    variant="secondary"
                    label={t('achievements.shareResult')}
                    onPress={() => router.push(storyPath(raceId))}
                  />
                ) : null}
              </AchievementCard>
            );
          }}
        </AsyncContent>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingVertical: space.s5 },
});
