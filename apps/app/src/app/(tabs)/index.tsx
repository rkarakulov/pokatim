import { size, space } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import { EmptyState, TextAction, useTheme } from '@rkarakulov/ui';
import { useRouter, type Href } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { OfflineBanner } from '@/components/offline-banner';
import { TopBar } from '@/components/top-bar';
import { DecorLayer } from '@/features/decor/decor-layer';
import { landingMetadata } from '@/features/landing/metadata';
import { HomeSection } from '@/features/home/home-section';
import { useUnreadCount } from '@/features/notifications/queries';
import { CalendarStartHero } from '@/features/calendar/calendar-hero';
import { RaceHero, RouteHero, RouteHeroSkeleton } from '@/features/home/heroes';
import {
  useLatestRoute,
  useNextCalendarStart,
  useNextRace,
  useRideReasons,
} from '@/features/home/queries';
import { useOwnAvatarId } from '@/features/profile/queries';
import { NameHint, useHomeNameHint } from '@/features/social/name-hint';
import { InstallBanner } from '@/features/pwa-install/install-banner';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { HomeTickets } from '@/features/tickets/home-tickets';
import { useMyTickets } from '@/features/tickets/queries';
import { useNextRide } from '@/features/rides/queries';
import { RideHero } from '@/features/rides/ride-hero';
import {
  AVAILABLE_HOME_SECTIONS,
  orderHomeSections,
  socialSlotIndex,
  type AvailableHomeSectionId,
} from '@/features/home/sections';
import { usePullToRefresh } from '@/lib/use-pull-to-refresh';
import { useMinskClock } from '@/lib/use-minsk-clock';

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
  rides: {
    kicker: 'home.rides.kicker',
    title: 'home.rides.title',
    all: 'home.rides.all',
    href: '/rides',
  },
  routes: {
    kicker: 'home.routes.kicker',
    title: 'home.routes.title',
    all: 'home.routes.all',
    href: '/routes',
  },
  calendar: {
    kicker: 'home.calendar.kicker',
    title: 'home.calendar.title',
    all: 'home.calendar.all',
    href: '/calendar',
  },
};

/**
 * Мета корня сайта (SSR) — мета гостевого лендинга (RC-3): превью ссылки на `/` = превью `/welcome`; тело `/` — скелетон
 * оболочки до гидрации, затем гард.
 */
export const generateMetadata = landingMetadata;

const DOCUMENT_TITLE = `${t('home.title')} — ${t('app.name')}`;

/**
 * Главная: верхняя панель и лента разделов («Гонки», «Кофе-райды», «Маршруты», «Календарь стартов»). Порядок — по ответам опроса (R4):
 * отмеченные — первыми с тегом; профиль ещё не пришёл или не загрузился — базовый порядок без ошибки на экране.
 * Обновление — pull-to-refresh (native) и фокус вкладки / возврат из фона (`focusManager`, R7).
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const profile = useRideReasons();
  const races = useNextRace();
  const calendar = useNextCalendarStart();
  const rides = useNextRide();
  const routes = useLatestRoute();
  // «Ваши билеты» (event-tickets): только вошедшему (пока сессия неизвестна, вкладки — скелетон оболочки)
  const signedIn = useSessionStore(isSignedIn);
  const tickets = useMyTickets(signedIn);
  const unread = useUnreadCount();
  // аватар верхней панели (rider-profile): тот же кэш `['profile']`, что порядок разделов — без второго запроса
  const avatarId = useOwnAvatarId();
  const sections = orderHomeSections(AVAILABLE_HOME_SECTIONS, profile.reasons);
  // подсказка имени K3 — на месте будущей секции «Свои» (K7, RC-P3-7): без слота (профиль не пришёл) — нет
  const nameHint = useHomeNameHint(signedIn);
  const hintSlot = nameHint.visible ? socialSlotIndex(sections, profile.reasons) : null;
  const hint =
    hintSlot === null ? null : (
      <View style={styles.hint}>
        <NameHint onLater={nameHint.later} />
      </View>
    );
  // «сейчас» подписей — на клиенте (Главная без SSR-данных, R6): новые данные, фокус, полночь по Минску
  const now = useMinskClock([
    races.dataUpdatedAt,
    rides.dataUpdatedAt,
    routes.dataUpdatedAt,
    calendar.dataUpdatedAt,
  ]);
  // без сети при показанных данных — баннер (§4.12); без данных «Нет соединения» показывает слот раздела
  const hasData =
    races.data !== undefined ||
    rides.data !== undefined ||
    routes.data !== undefined ||
    calendar.data !== undefined;
  const refetchers = useMemo(
    () => [
      races.refetch,
      rides.refetch,
      routes.refetch,
      calendar.refetch,
      profile.refetch,
      tickets.refetch,
    ],
    [
      races.refetch,
      rides.refetch,
      routes.refetch,
      calendar.refetch,
      profile.refetch,
      tickets.refetch,
    ],
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetchers);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <TopBar
        onOpenNotifications={() => router.push('/notifications')}
        unreadCount={unread.data?.count}
        onOpenDevices={() => router.push('/settings/devices')}
        onOpenSettings={() => router.push('/settings')}
        onOpenProfile={() => router.push('/profile')}
        avatarId={avatarId}
      />
      {/* область ленты — опора сезонного декора (halloween-decor): слой поверх ленты, без шапки */}
      <View style={styles.feed}>
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
          <OfflineBanner hasData={hasData} style={styles.banner} />
          <HomeTickets query={tickets} />
          {sections.map(({ id, chosen }, index) => {
            const before = index === hintSlot ? hint : null;
            const copy = SECTION_COPY[id];
            const frame = {
              kicker: t(copy.kicker),
              title: t(copy.title),
              chosen,
              first: index === 0,
              all: { label: t(copy.all), onPress: () => router.navigate(copy.href) },
            };
            const section =
              id === 'races' ? (
                <HomeSection
                  key={id}
                  {...frame}
                  query={races}
                  empty={{
                    when: (page) => page.items.length === 0,
                    render: () => (
                      <EmptyState
                        title={t('home.races.empty')}
                        action={{
                          label: t('home.races.emptyAction'),
                          onPress: () => router.navigate('/calendar'),
                        }}
                      />
                    ),
                  }}
                >
                  {(page) => {
                    const race = page.items[0];
                    return race ? (
                      <RaceHero
                        race={race}
                        now={now}
                        onPress={() => router.push(`/races/${race.id}`)}
                      />
                    ) : null;
                  }}
                </HomeSection>
              ) : id === 'rides' ? (
                <HomeSection
                  key={id}
                  {...frame}
                  query={rides}
                  empty={{
                    when: (page) => page.items.length === 0,
                    render: () => (
                      <EmptyState
                        title={t('home.rides.empty')}
                        action={{
                          label: t('home.rides.emptyAction'),
                          onPress: () => router.push('/rides/new'),
                        }}
                      />
                    ),
                  }}
                >
                  {(page) => {
                    const ride = page.items[0];
                    return ride ? (
                      <RideHero
                        ride={ride}
                        now={now}
                        onPress={() => router.push(`/rides/${ride.id}`)}
                      />
                    ) : null;
                  }}
                </HomeSection>
              ) : id === 'routes' ? (
                // RC-8: пустой каталог — пустой герой раздела, без скрытия (правило Главной)
                <HomeSection
                  key={id}
                  {...frame}
                  query={routes}
                  skeleton={<RouteHeroSkeleton />}
                  empty={{
                    when: (page) => page.items.length === 0,
                    render: () => <EmptyState title={t('home.routes.empty')} />,
                  }}
                >
                  {(page) => {
                    const route = page.items[0];
                    return route ? (
                      <RouteHero route={route} onPress={() => router.push(`/routes/${route.id}`)} />
                    ) : null;
                  }}
                </HomeSection>
              ) : (
                <HomeSection
                  key={id}
                  {...frame}
                  query={calendar}
                  empty={{
                    when: (page) => page.items.length === 0,
                    render: () => <EmptyState title={t('calendar.empty')} />,
                  }}
                >
                  {(page) => {
                    const start = page.items[0];
                    return start ? (
                      <CalendarStartHero
                        start={start}
                        now={now}
                        onPress={() => router.push(`/calendar/${start.id}`)}
                      />
                    ) : null;
                  }}
                </HomeSection>
              );
            return (
              <Fragment key={id}>
                {before}
                {section}
              </Fragment>
            );
          })}
          {hintSlot !== null && hintSlot >= sections.length ? hint : null}
          {/* витрина компонентов — только в dev; «Выйти» — в «Настройках» (settings-hub) */}
          {__DEV__ ? (
            <View style={styles.footer}>
              <TextAction label={t('uiKit.open')} onPress={() => router.push('/ui-kit')} />
            </View>
          ) : null}
        </ScrollView>
        <DecorLayer />
      </View>
      {/* «Установить приложение» (только web) — под лентой, над вкладками: декор ленты её не перекрывает */}
      <InstallBanner />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  feed: { flex: 1 },
  banner: { paddingHorizontal: size.gutter, paddingBottom: space.s3 },
  hint: { paddingHorizontal: size.gutter, paddingVertical: space.s3 },
  footer: {
    paddingHorizontal: size.gutter,
    paddingVertical: space.s5,
    gap: space.s3,
    alignItems: 'flex-start',
  },
});
