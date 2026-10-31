import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AsyncContent, Button, Kicker, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import {
  catalogEntry,
  flashKey,
  flashQueue,
  isLevelUp,
  seasonOf,
  seenTarget,
  type KnownAchievement,
} from './achievement-catalog';
import { AchievementCard, AchievementCardSkeleton } from './achievement-card';
import { closePresented, hiddenKeys, markShown, openPresented } from './flash-session';
import { ACHIEVEMENTS_KEY, useAchievements, useMarkAchievementsSeen } from './queries';
import { achievementStoryPath } from './story/achievement-story';

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
 * на последнем — «Закрыть»; «Поделиться» → карточка достижения для сторис (вместо вспышки; у сезонных — с сезоном,
 * C1); сезонное — «К сезону» → `/seasons/<id>` (вместо вспышки). Повышение уровня (серебро, золото) —
 * заголовок «Новый уровень» (L6), ключ сессии — `flashKey` (ключ элемента и уровень, RC-L4).
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
    data ? { queue: flashQueue(data.items, hiddenKeys(dataUpdatedAt)), at: dataUpdatedAt } : null,
  );
  const [index, setIndex] = useState(0);
  const { mutate } = useMarkAchievementsSeen();

  // открыта без данных: снимок — с первым ответом (обновление состояния при рендере, без лишнего эффекта)
  if (snapshot === null && data) {
    setSnapshot({ queue: flashQueue(data.items, hiddenKeys(dataUpdatedAt)), at: dataUpdatedAt });
  }

  // очередь скрыта, пока вспышка открыта; при уходе — до ответа новее последнего на этот момент (в том числе
  // пришедшего за время показа: фокус вкладки, возврат из фона — ревью pass 2, LOW-1)
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!snapshot) return;
    openPresented(snapshot.queue.map(flashKey));
    return () =>
      closePresented(queryClient.getQueryState(ACHIEVEMENTS_KEY)?.dataUpdatedAt ?? snapshot.at);
  }, [snapshot, queryClient]);

  const queue = snapshot?.queue ?? null;
  const current = queue?.[index];
  // ключ сессии — ключ элемента и уровень (RC-L4); `POST seen` — по адресу (сезонные — код и сезон)
  const key = current ? flashKey(current) : undefined;
  const target = current ? seenTarget(current) : undefined;
  const targetCode = target?.code;
  const targetSeason = target?.seasonId ?? null;
  useEffect(() => {
    if (!targetCode || !key) return;
    markShown(key);
    mutate([{ code: targetCode, seasonId: targetSeason }]);
  }, [targetCode, targetSeason, key, mutate]);

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

  const last = index === queue.length - 1;
  const seasonId = seasonOf(current);

  return (
    <FlashShell>
      <View style={styles.head}>
        <Kicker
          label={t(isLevelUp(current) ? 'achievements.flash.levelUp' : 'achievements.flash.kicker')}
        />
        {queue.length > 1 ? (
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
            {t('achievements.flash.counter', { current: index + 1, total: queue.length })}
          </Text>
        ) : null}
      </View>
      <AchievementCard key={flashKey(current)} item={current} animated>
        {catalogEntry(current.code).storyCard ? (
          <Button
            variant="secondary"
            label={t('achievements.share')}
            onPress={() => router.replace(achievementStoryPath(current.code, seasonId))}
          />
        ) : null}
        {seasonId !== null ? (
          <Button
            variant="secondary"
            label={t('achievements.toSeason')}
            onPress={() => router.replace(`/seasons/${seasonId}`)}
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
