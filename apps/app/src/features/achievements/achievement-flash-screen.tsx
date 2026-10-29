import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Button, Kicker, textStyle, useTheme } from '@rkarakulov/ui';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { storyPath } from '@/features/races/story/paths';

import { flashQueue, shareRaceId, type KnownAchievement } from './achievement-catalog';
import { AchievementCard } from './achievement-card';
import { markShown, shownCodes } from './flash-session';
import { useAchievements, useMarkAchievementsSeen } from './queries';

const DOCUMENT_TITLE = `${t('achievements.flash.kicker')} — ${t('app.name')}`;

/**
 * «Вспышка достижения» (`/achievements/flash`, A5, A6, AC9–AC11): полноэкранный модальный экран поверх вкладок. Очередь
 * — снимок при открытии (неувиденные, ещё не показанные в этом запуске, от старых к новым): пометки `seen` и
 * перезапросы её не меняют. Показанное помечается сразу (`POST seen`) — закрытие жестом «назад» тоже «просмотрено».
 * «Дальше» — следующее, на последнем — «Закрыть»; у гоночных — «Поделиться» → сторис результата (вместо вспышки).
 * Очереди нет (адрес открыли напрямую, всё уже показано) — назад или на Главную.
 */
export function AchievementFlashScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { data } = useAchievements();
  const [queue, setQueue] = useState<KnownAchievement[] | null>(() =>
    data ? flashQueue(data.items, shownCodes()) : null,
  );
  const [index, setIndex] = useState(0);
  const markSeen = useMarkAchievementsSeen();
  const { mutate } = markSeen;

  // холодный старт по адресу: снимок — с первым ответом (обновление состояния при рендере, без лишнего эффекта)
  if (queue === null && data) setQueue(flashQueue(data.items, shownCodes()));

  const current = queue?.[index];
  const code = current?.code;
  useEffect(() => {
    if (!code) return;
    markShown(code);
    mutate([code]);
  }, [code, mutate]);

  const empty = queue !== null && !current;
  useEffect(() => {
    if (empty && router.canGoBack()) router.back();
  }, [empty, router]);

  if (queue === null) return null;
  if (!current) return router.canGoBack() ? null : <Redirect href="/" />;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const raceId = shareRaceId(current);
  const last = index === queue.length - 1;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.surface.default }]}>
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView testID="achievement-flash" contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Kicker label={t('achievements.flash.kicker')} />
          {queue.length > 1 ? (
            <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
              {t('achievements.flash.counter', { current: index + 1, total: queue.length })}
            </Text>
          ) : null}
        </View>
        <AchievementCard key={current.code} item={current} animated>
          {raceId !== null ? (
            <Button
              variant="secondary"
              label={t('achievements.share')}
              onPress={() => router.replace(storyPath(raceId))}
            />
          ) : null}
          {last ? (
            <Button label={t('achievements.close')} onPress={close} />
          ) : (
            <Button label={t('achievements.next')} onPress={() => setIndex(index + 1)} />
          )}
        </AchievementCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: size.gutter,
    paddingVertical: space.s6,
    gap: space.s5,
  },
  head: { alignItems: 'center', gap: space.s1 },
});
