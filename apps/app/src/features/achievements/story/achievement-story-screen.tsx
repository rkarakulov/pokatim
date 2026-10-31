import { AchievementCode, Uuid } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { EmptyState, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { CardPanel } from '@/features/sharing/card-panel';

import { achievementPath, achievementTitle, catalogEntry } from '../achievement-catalog';
import { achievementStorySource } from './achievement-story';

/**
 * Карточка своего достижения для сторис (`/achievements/story/<code>`, сезонное — `?season=<id>`, внутри
 * `Stack.Protected`): общая панель карточки (`CardPanel`, рендер сервера ADR-0018). Не получено, отозвано (409) и
 * незнакомый код — «Карточки нет» и «К достижению». Сезонный код без валидного `season` — «Карточки нет» без запроса,
 * переход — в профиль; у несезонного `season` игнорируется (RC-8). Права — только сервер.
 */
export function AchievementStoryScreen({ code, season }: { code: string; season?: string | null }) {
  const theme = useTheme();
  const router = useRouter();
  const parsed = AchievementCode.safeParse(code);
  const entry = parsed.success ? catalogEntry(parsed.data) : null;
  const seasonId = entry?.seasonal ? (Uuid.safeParse(season).data ?? null) : null;
  const valid =
    parsed.success && entry?.storyCard && (!entry.seasonal || seasonId !== null)
      ? parsed.data
      : null;
  const source = useMemo(
    () => (valid ? achievementStorySource(valid, seasonId) : null),
    [valid, seasonId],
  );
  // «К достижению» — к экрану этого достижения в стеке (как «К райду»); незнакомый код — в профиль
  const back = () =>
    valid ? router.dismissTo(achievementPath(valid, seasonId)) : router.navigate('/profile');
  const empty = (
    <EmptyState
      title={t('achievementCard.empty.title')}
      message={t('achievementCard.empty.message')}
      action={{ label: t('achievementCard.empty.action'), onPress: back }}
    />
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${t('achievementCard.title')} — ${t('app.name')}`} />
      <DetailHeader
        title={t('achievementCard.title')}
        fallback={valid ? achievementPath(valid, seasonId) : '/profile'}
      />
      <ScrollView testID="achievement-story" contentContainerStyle={styles.content}>
        {valid && source ? (
          <CardPanel
            source={source}
            enabled
            previewLabel={t('achievementCard.preview', { title: achievementTitle(valid) })}
            shareTitle={achievementTitle(valid)}
            hint={t('achievementCard.hint')}
            empty={empty}
          />
        ) : (
          empty
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingVertical: space.s5 },
});
