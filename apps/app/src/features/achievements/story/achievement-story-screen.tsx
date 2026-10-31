import { AchievementCode } from '@pokatim/contracts';
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

import { achievementTitle, catalogEntry } from '../achievement-catalog';
import { achievementPath, achievementStorySource } from './achievement-story';

/**
 * Карточка своего достижения для сторис (`/achievements/story/<code>`, внутри `Stack.Protected`): общая панель
 * карточки (`CardPanel`, рендер сервера ADR-0018). Не получено, отозвано (409) и незнакомый код — «Карточки нет» и «К
 * достижению». Сезонный код по прямому адресу — «Карточки нет» без запроса, переход — в профиль (S7). Права — только сервер.
 */
export function AchievementStoryScreen({ code }: { code: string }) {
  const theme = useTheme();
  const router = useRouter();
  const parsed = AchievementCode.safeParse(code);
  // сезонные — без карточки (S7): без запроса, назад — в профиль
  const valid = parsed.success && catalogEntry(parsed.data).storyCard ? parsed.data : null;
  const source = useMemo(() => (valid ? achievementStorySource(valid) : null), [valid]);
  // «К достижению» — к экрану этого достижения в стеке (как «К райду»); незнакомый код — в профиль
  const back = () =>
    valid ? router.dismissTo(achievementPath(valid)) : router.navigate('/profile');
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
        fallback={valid ? achievementPath(valid) : '/profile'}
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
