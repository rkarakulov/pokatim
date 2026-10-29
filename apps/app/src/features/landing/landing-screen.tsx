import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Button,
  EmptyState,
  SkeletonHeroCard,
  SkeletonListRow,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { RouteListCard, RouteListCardSkeleton } from '@/components/route-list-card';
import { CalendarStartHero } from '@/features/calendar/calendar-hero';
import { RaceHero } from '@/features/home/heroes';
import { useNextCalendarStart, useNextRace } from '@/features/home/queries';
import { InstallBanner } from '@/features/pwa-install/install-banner';
import { useCurrentSeason } from '@/features/races/queries';
import { SeasonLinkRow } from '@/features/races/season-row';
import { useMinskClockAfterMount } from '@/lib/use-minsk-clock';

import { LandingSection } from './landing-section';
import { useLandingRoutes } from './queries';
import type { LandingSeed } from './ssr';

/** Призыв: «Зарегистрироваться» (основная) и «Войти» (вторичная) — в герое и внизу. */
function CallToAction() {
  const router = useRouter();
  return (
    <View style={styles.actions}>
      <Button label={t('landing.cta.register')} onPress={() => router.push('/register')} />
      <Button
        label={t('landing.cta.signIn')}
        variant="secondary"
        onPress={() => router.push('/sign-in')}
      />
    </View>
  );
}

/**
 * Гостевой лендинг `/welcome` (guest-landing, G3): герой, «Гонки по маршруту», «Сезон», «Кофе-райды» (только текст),
 * «Маршруты», «Календарь стартов», нижний призыв. Живые блоки — публичные списки (G4) с посевом SSR (`seed`); пусто —
 * подпись раздела, ошибка и нет сети — блок скрыт (G5). «Сейчас» — после монтирования: SSR и гидрация без «сегодня».
 */
export function LandingScreen({ seed }: { seed?: LandingSeed }) {
  const theme = useTheme();
  const router = useRouter();
  const races = useNextRace(seed?.races ?? undefined);
  const season = useCurrentSeason(seed?.season ?? undefined);
  const routes = useLandingRoutes(seed?.routes ?? undefined);
  const calendar = useNextCalendarStart(seed?.calendar ?? undefined);
  const now = useMinskClockAfterMount([races.dataUpdatedAt, calendar.dataUpdatedAt]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.surface.default }]}>
      <DocumentTitle title={t('landing.title')} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          {/* словесный знак — не заголовок (RC-6): заголовок экрана — `landing.hero.title` */}
          <Text style={[textStyle('brand'), { color: theme.text.primary }]}>
            {t('home.wordmark')}
          </Text>
          <Text
            accessibilityRole="header"
            style={[textStyle('displayTitle'), { color: theme.text.primary }]}
          >
            {t('landing.hero.title')}
          </Text>
          <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
            {t('landing.hero.lead')}
          </Text>
          <CallToAction />
        </View>

        <LandingSection
          title={t('landing.races.title')}
          text={t('landing.races.text')}
          live={{
            query: races,
            skeleton: <SkeletonHeroCard />,
            render: (page) => {
              const race = page.items[0];
              return race ? (
                <RaceHero race={race} now={now} onPress={() => router.push(`/races/${race.id}`)} />
              ) : (
                <EmptyState title={t('home.races.empty')} />
              );
            },
          }}
        />
        <LandingSection
          title={t('landing.season.title')}
          text={t('landing.season.text')}
          live={{
            query: season,
            skeleton: <SkeletonListRow />,
            render: ({ season: current }) =>
              current ? (
                <SeasonLinkRow
                  season={current}
                  onPress={() => router.push(`/seasons/${current.id}`)}
                />
              ) : null,
          }}
        />
        <LandingSection title={t('landing.rides.title')} text={t('landing.rides.text')} />
        <LandingSection
          title={t('landing.routes.title')}
          text={t('landing.routes.text')}
          live={{
            query: routes,
            skeleton: <RouteListCardSkeleton />,
            render: (page) =>
              page.items.length > 0 ? (
                <View style={styles.list}>
                  {page.items.slice(0, 3).map((route) => (
                    <RouteListCard
                      key={route.id}
                      route={route}
                      onPress={() => router.push(`/routes/${route.id}`)}
                    />
                  ))}
                </View>
              ) : (
                <EmptyState title={t('home.routes.empty')} />
              ),
          }}
        />
        <LandingSection
          title={t('landing.calendar.title')}
          text={t('landing.calendar.text')}
          live={{
            query: calendar,
            skeleton: <SkeletonHeroCard />,
            render: (page) => {
              const start = page.items[0];
              return start ? (
                <CalendarStartHero
                  start={start}
                  now={now}
                  onPress={() => router.push(`/calendar/${start.id}`)}
                />
              ) : (
                <EmptyState title={t('calendar.empty')} />
              );
            },
          }}
        />

        <View style={[styles.footer, { borderTopColor: theme.border.subtle }]}>
          <Text
            accessibilityRole="header"
            style={[textStyle('displayTitle'), { color: theme.text.primary }]}
          >
            {t('landing.footer.title')}
          </Text>
          <CallToAction />
        </View>
      </ScrollView>
      {/* «Установить приложение» (только web) — внизу лендинга, под прокруткой */}
      <InstallBanner />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingTop: space.s6, paddingBottom: space.s6 },
  hero: { gap: space.s3, paddingBottom: size.sectionGap },
  actions: { marginTop: space.s3, gap: space.s3 },
  list: { gap: space.s3 },
  footer: {
    borderTopWidth: stroke.hairline,
    marginTop: size.sectionGap,
    paddingTop: size.sectionGap,
    gap: space.s3,
  },
});
