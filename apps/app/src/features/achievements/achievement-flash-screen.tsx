import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Button, Kicker, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { storyPath } from '@/features/races/story/paths';

import { flashQueue, shareRaceId, type KnownAchievement } from './achievement-catalog';
import { AchievementCard, AchievementCardSkeleton } from './achievement-card';
import { hiddenCodes, markPresented, markShown } from './flash-session';
import { useAchievements, useMarkAchievementsSeen } from './queries';

const DOCUMENT_TITLE = `${t('achievements.flash.kicker')} — ${t('app.name')}`;

/** Оболочка вспышки: фон, заголовок документа, прокрутка по центру. */
function FlashShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.surface.default }]}>
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView testID="achievement-flash" contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * «Вспышка достижения» (`/achievements/flash`, A5, A6, AC9–AC11): полноэкранный модальный экран поверх вкладок. Очередь
 * — снимок при открытии (неувиденные, не показанные в этом запуске, от старых к новым): пометки `seen` и перезапросы
 * её не меняют; весь снимок отмечается в `flash-session` — уход «назад» или через «Поделиться» посреди очереди не
 * открывает вспышку снова до нового ответа сервера. Показанное помечается сразу (`POST seen`). «Дальше» — следующее,
 * на последнем — «Закрыть»; у гоночных — «Поделиться» → сторис результата (вместо вспышки).
 *
 * Открыта по адресу без данных (обновление страницы web, холодный старт по ссылке): скелетон карточки, ошибка и
 * офлайн — `AsyncContent` с повтором и «Закрыть» сверху (§4.12). Очереди нет — назад или на Главную.
 */
export function AchievementFlashScreen() {
  const theme = useTheme();
  const router = useRouter();
  const query = useAchievements();
  const { data, dataUpdatedAt } = query;
  const [snapshot, setSnapshot] = useState<{ queue: KnownAchievement[]; at: number } | null>(() =>
    data ? { queue: flashQueue(data.items, hiddenCodes(dataUpdatedAt)), at: dataUpdatedAt } : null,
  );
  const [index, setIndex] = useState(0);
  const { mutate } = useMarkAchievementsSeen();

  // открыта без данных: снимок — с первым ответом (обновление состояния при рендере, без лишнего эффекта)
  if (snapshot === null && data) {
    setSnapshot({ queue: flashQueue(data.items, hiddenCodes(dataUpdatedAt)), at: dataUpdatedAt });
  }

  useEffect(() => {
    if (snapshot)
      markPresented(
        snapshot.queue.map((item) => item.code),
        snapshot.at,
      );
  }, [snapshot]);

  const queue = snapshot?.queue ?? null;
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

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (queue === null) {
    return (
      <FlashShell>
        <View style={styles.start}>
          <TextAction label={t('achievements.close')} onPress={close} />
        </View>
        <AsyncContent query={query} skeleton={<AchievementCardSkeleton />}>
          {() => null}
        </AsyncContent>
      </FlashShell>
    );
  }
  if (!current) return router.canGoBack() ? null : <Redirect href="/" />;

  const raceId = shareRaceId(current);
  const last = index === queue.length - 1;

  return (
    <FlashShell>
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
    </FlashShell>
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
  start: { alignItems: 'flex-start' },
});
