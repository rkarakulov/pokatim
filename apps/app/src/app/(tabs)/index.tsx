import { size, space } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import { TextAction, useTheme, type AsyncState } from '@rkarakulov/ui';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { TopBar } from '@/components/top-bar';
import { useSignOut } from '@/features/auth/use-sign-out';
import { HomeSection } from '@/features/home/home-section';
import { useRideReasons } from '@/features/home/queries';
import {
  AVAILABLE_HOME_SECTIONS,
  orderHomeSections,
  type AvailableHomeSectionId,
} from '@/features/home/sections';
import { usePullToRefresh } from '@/features/home/use-pull-to-refresh';

/** Шапка раздела и вкладка «Все …». */
const SECTION_COPY: Record<
  AvailableHomeSectionId,
  { kicker: MessageKey; title: MessageKey; all: MessageKey; href: Href }
> = {
  races: {
    kicker: 'home.races.kicker',
    title: 'home.races.title',
    all: 'home.races.all',
    href: '/races',
  },
  calendar: {
    kicker: 'home.calendar.kicker',
    title: 'home.calendar.title',
    all: 'home.calendar.all',
    href: '/calendar',
  },
};

/** Каркас (S3): данные разделов — публичные list-эндпоинты admin-02 (S4); до них слот — скелетон героя. */
const SECTION_PENDING: AsyncState<never> = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
  fetchStatus: 'idle',
  refetch: () => undefined,
};

const DOCUMENT_TITLE = `${t('home.title')} — ${t('app.name')}`;

/**
 * Главная: верхняя панель и лента разделов («Гонки», «Календарь стартов»). Порядок — по ответам опроса (R4):
 * отмеченные — первыми с тегом; профиль ещё не пришёл или не загрузился — базовый порядок без ошибки на экране.
 * Обновление — pull-to-refresh (native) и фокус вкладки / возврат из фона (`focusManager`, R7).
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);
  const profile = useRideReasons();
  const sections = orderHomeSections(AVAILABLE_HOME_SECTIONS, profile.reasons);
  const refetchers = useMemo(() => [profile.refetch], [profile.refetch]);
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  const onSignOut = async () => {
    setSigningOut(true);
    // экран уйдёт по гарду; неудачи нет — офлайн выход локальный
    await signOut();
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <TopBar />
      <ScrollView
        testID="home-feed"
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
        {sections.map(({ id, chosen }, index) => {
          const copy = SECTION_COPY[id];
          return (
            <HomeSection
              key={id}
              kicker={t(copy.kicker)}
              title={t(copy.title)}
              chosen={chosen}
              first={index === 0}
              all={{ label: t(copy.all), onPress: () => router.navigate(copy.href) }}
              query={SECTION_PENDING}
            >
              {() => null}
            </HomeSection>
          );
        })}
        {/* временно на «Главной» (Q8) — до экрана профиля */}
        <View style={styles.footer}>
          {__DEV__ ? (
            <TextAction label={t('uiKit.open')} onPress={() => router.push('/ui-kit')} />
          ) : null}
          <TextAction
            label={t('auth.signOut')}
            onPress={() => void onSignOut()}
            disabled={signingOut}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  footer: {
    paddingHorizontal: size.gutter,
    paddingVertical: space.s5,
    gap: space.s3,
    alignItems: 'flex-start',
  },
});
