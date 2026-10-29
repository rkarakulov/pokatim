import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Button, EmptyState, SkeletonText, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { storyPath } from '@/features/races/story/paths';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';

import { achievementTitle, knownItems, shareRaceId } from './achievement-catalog';
import { AchievementCard } from './achievement-card';
import { BADGE_SIZE } from './achievement-badge';
import { useAchievements } from './queries';

const DOCUMENT_TITLE = `${t('achievements.title')} — ${t('app.name')}`;

/**
 * Экран своего достижения (`/achievements/<code>`, A5–A6): тот же макет, что вспышка, без «Дальше»; вход — плитка
 * блока «Достижения» в `/profile`. Данные — тот же кэш `['achievements']`. Кода нет в списке (отозвано, незнакомый
 * адрес) — пустое состояние с переходом в профиль. Экран `seen` не шлёт: вспышку показывает только хост.
 */
export function AchievementScreen({ code }: { code: string }) {
  const theme = useTheme();
  const router = useRouter();
  const query = useAchievements();
  const { refreshing, onRefresh } = usePullToRefresh([query.refetch]);
  const item = query.data ? knownItems(query.data.items).find((a) => a.code === code) : undefined;

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
        <AsyncContent
          query={query}
          skeleton={
            <View style={styles.skeleton}>
              <SkeletonText variant="displaySm" lines={1} lastLineWidth="60%" />
              <SkeletonText variant="body" lines={2} lastLineWidth="80%" />
            </View>
          }
        >
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
            return (
              <AchievementCard item={item}>
                {raceId !== null ? (
                  <Button
                    label={t('achievements.share')}
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
  skeleton: { minHeight: BADGE_SIZE.hero, gap: space.s3 },
});
