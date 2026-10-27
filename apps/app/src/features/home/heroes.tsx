import type { CatalogRouteCard, RaceCard } from '@pokatim/contracts';
import {
  radius,
  shapeOf,
  size,
  space,
  type AppTheme,
  type AppThemeLayout,
} from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SkeletonHeroCard, SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SectionHero } from '@/components/section-hero';

import { formatRaceWindow, raceHeroLine, raceMeta } from '@/features/races/format';
import { routeHeroDate, routePlace, routeStats } from '@/features/routes/format';
import { catalogRouteMapOptions } from '@/features/routes/queries';
import { RouteContour } from '@/features/routes/route-contour';
import { useAppTheme } from '@/theme/use-app-theme';

const present = (lines: (string | null)[]) => lines.filter((line): line is string => !!line);

/**
 * Герои разделов Главной. «Сейчас» — на клиенте: Главная без SSR-данных (R6), подписи «сегодня / через N дней»
 * рендерятся только после монтирования.
 */
export function RaceHero({
  race,
  now,
  onPress,
}: {
  race: RaceCard;
  now: Date;
  /** Герой ведёт в карточку гонки (Q12 блока 03). */
  onPress: () => void;
}) {
  return (
    <SectionHero
      kicker={t('home.races.heroKicker')}
      date={formatRaceWindow(race.windowStartsAt, race.windowEndsAt, now)}
      title={race.title}
      meta={present([raceMeta(race), raceHeroLine(race, now)])}
      onPress={onPress}
    />
  );
}

interface RouteHeroProps {
  route: CatalogRouteCard;
  onPress: () => void;
}

/** Метка героя для скринридера — та же, что у `SectionHero`: «кикер. название. 86 км». */
function routeHeroLabel(route: CatalogRouteCard): string {
  const date = routeHeroDate(route);
  return `${t('home.routes.heroKicker')}. ${route.title}. ${date.value} ${date.unit}`;
}

/**
 * «Классика» (routes-01, RC-8): текстовый герой — длина крупно, название, «набор · петля» и «город · покрытие»; линии
 * маршрута нет (без запроса карты и второго рендера).
 */
function ClassicRouteHero({ route, onPress }: RouteHeroProps) {
  return (
    <SectionHero
      kicker={t('home.routes.heroKicker')}
      date={routeHeroDate(route)}
      title={route.title}
      meta={present([routeStats(route), routePlace(route)])}
      onPress={onPress}
    />
  );
}

/**
 * Панель с контуром маршрута (`GET /v1/routes/:id/map`, кэш общий с карточкой маршрута): пока геометрия грузится —
 * скелетон того же размера; ошибка или 404 — панель без контура, тихо (как карта в карточке).
 */
function ContourPanel({
  routeId,
  background,
  color,
  startColor,
}: {
  routeId: string;
  /** фон панели; `null` — прозрачная (фон рисует родитель) */
  background: string | null;
  color: string;
  startColor: string;
}) {
  const theme = useTheme<AppTheme>();
  const map = useQuery(catalogRouteMapOptions(routeId));
  if (map.isPending) {
    return (
      <View
        testID="route-hero-contour-skeleton"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface.skeleton }]}
      />
    );
  }
  return (
    <View
      testID="route-hero-panel"
      style={[StyleSheet.absoluteFill, background ? { backgroundColor: background } : null]}
    >
      {map.data ? <RouteContour geometry={map.data} color={color} startColor={startColor} /> : null}
    </View>
  );
}

/** Круглая кнопка-стрелка героя: декоративная (вся карточка — одна ссылка), скрыта от скринридера. */
function HeroArrow({ background, color }: { background: string; color: string }) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.arrow, { backgroundColor: background }]}
    >
      <Icon name="arrowRight" size={size.icon} color={color} />
    </View>
  );
}

/**
 * Атлас, Планировщик, Навигация (app-themes C2, T4): панель `map.background` с контуром маршрута и точкой старта,
 * ниже — название и мета; в углу панели — кнопка-стрелка. Весь блок — одна ссылка.
 */
function ContourRouteHero({ route, onPress }: RouteHeroProps) {
  const theme = useTheme<AppTheme>();
  const shape = shapeOf(theme);
  return (
    <Pressable
      accessible
      accessibilityRole="link"
      accessibilityLabel={routeHeroLabel(route)}
      onPress={onPress}
    >
      <View style={[styles.panel, { borderRadius: shape.card }]}>
        <ContourPanel
          routeId={route.id}
          background={theme.map.background}
          color={theme.map.route}
          startColor={theme.map.start}
        />
        <View style={styles.arrowCorner}>
          <HeroArrow background={theme.action.primary} color={theme.action.onPrimary} />
        </View>
      </View>
      <Text style={[textStyle('displayTitle'), styles.title, { color: theme.text.primary }]}>
        {route.title}
      </Text>
      <HeroMeta route={route} />
    </Pressable>
  );
}

/**
 * Типографика (app-themes C2): слева дистанция крупной цифрой с единицей, название заглавными и мета; справа —
 * блок `action.primary` с наклонной кромкой, в нём контур и стрелка. Весь блок — одна ссылка.
 */
function NumeralRouteHero({ route, onPress }: RouteHeroProps) {
  const theme = useTheme<AppTheme>();
  const date = routeHeroDate(route);
  return (
    <Pressable
      accessible
      accessibilityRole="link"
      accessibilityLabel={routeHeroLabel(route)}
      onPress={onPress}
      style={styles.numeralRow}
    >
      <View style={styles.numeralText}>
        <View testID="route-hero-numeral" style={styles.numeralValue}>
          <Text style={[textStyle('displayNumeral'), { color: theme.text.primary }]}>
            {date.value}
          </Text>
          <Text style={[textStyle('unit'), { color: theme.text.secondary }]}>{date.unit}</Text>
        </View>
        <Text style={[textStyle('displaySm'), styles.caps, { color: theme.text.primary }]}>
          {route.title}
        </Text>
        <HeroMeta route={route} />
      </View>
      <View style={styles.diagonal}>
        <View style={[styles.diagonalFill, { backgroundColor: theme.action.primary }]} />
        <ContourPanel
          routeId={route.id}
          background={null}
          color={theme.action.onPrimary}
          startColor={theme.action.primary}
        />
        <View style={styles.arrowCorner}>
          <Icon name="arrowRight" size={size.icon} color={theme.action.onPrimary} />
        </View>
      </View>
    </Pressable>
  );
}

function HeroMeta({ route }: { route: CatalogRouteCard }) {
  const theme = useTheme<AppTheme>();
  return (
    <View style={styles.meta}>
      {present([routeStats(route), routePlace(route)]).map((line) => (
        <Text key={line} style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** Вариант героя «Маршрутов» по раскладке темы (полноту таблицы проверяет тип). */
const ROUTE_HERO: Record<AppThemeLayout['home'], ComponentType<RouteHeroProps>> = {
  classic: ClassicRouteHero,
  contour: ContourRouteHero,
  numeral: NumeralRouteHero,
};

/**
 * Герой раздела «Маршруты» Главной: вариант — по теме (`layout.home`, app-themes C2). У «Классики» — текстовый
 * (RC-8), у тем с картой — контур маршрута. Ведёт в карточку маршрута.
 */
export function RouteHero(props: RouteHeroProps) {
  const Hero = ROUTE_HERO[useAppTheme().layout.home];
  return <Hero {...props} />;
}

/** Скелетон героя «Контур»: панель той же высоты и формы, название, мета. */
function ContourHeroSkeleton() {
  const theme = useTheme<AppTheme>();
  return (
    <View testID="route-hero-skeleton-contour">
      <View
        style={[
          styles.panel,
          { borderRadius: shapeOf(theme).card, backgroundColor: theme.surface.skeleton },
        ]}
      />
      <View style={styles.title}>
        <SkeletonText variant="displayTitle" lines={1} lastLineWidth="70%" />
      </View>
      <View style={styles.meta}>
        <SkeletonText variant="meta" lines={2} lastLineWidth="50%" />
      </View>
    </View>
  );
}

/** Скелетон героя «Крупная цифра»: цифра, название, мета слева; блок справа. */
function NumeralHeroSkeleton() {
  const theme = useTheme<AppTheme>();
  return (
    <View testID="route-hero-skeleton-numeral" style={styles.numeralRow}>
      <View style={[styles.numeralText, styles.skeletonGap]}>
        <SkeletonText variant="displayNumeral" lines={1} lastLineWidth="60%" />
        <SkeletonText variant="displaySm" lines={1} lastLineWidth="80%" />
        <SkeletonText variant="meta" lines={2} lastLineWidth="50%" />
      </View>
      <View style={[styles.diagonal, { backgroundColor: theme.surface.skeleton }]} />
    </View>
  );
}

/** Скелетон героя «Маршрутов» по раскладке темы (первая загрузка раздела). */
const ROUTE_HERO_SKELETON: Record<AppThemeLayout['home'], ComponentType> = {
  classic: SkeletonHeroCard,
  contour: ContourHeroSkeleton,
  numeral: NumeralHeroSkeleton,
};

export function RouteHeroSkeleton() {
  const Skeleton = ROUTE_HERO_SKELETON[useAppTheme().layout.home];
  return <Skeleton />;
}

/** Наклон кромки диагонального блока Типографики (раскладка, не размер). */
const DIAGONAL_SKEW = '-12deg';

const styles = StyleSheet.create({
  panel: { height: size.heroHeight, overflow: 'hidden' },
  arrowCorner: { position: 'absolute', right: space.s3, bottom: space.s3 },
  arrow: {
    width: size.buttonHeight,
    height: size.buttonHeight,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { marginTop: space.s3 },
  meta: { paddingTop: space.s2, gap: space.s1 },
  numeralRow: { flexDirection: 'row', columnGap: space.s3, minHeight: size.heroHeight },
  numeralText: { flex: 1, justifyContent: 'flex-end' },
  numeralValue: { flexDirection: 'row', alignItems: 'baseline', columnGap: space.s1 },
  caps: { textTransform: 'uppercase', marginTop: space.s1 },
  diagonal: { flex: 1, overflow: 'hidden' },
  skeletonGap: { gap: space.s2 },
  // наклонная левая кромка: заливка шире блока и скошена, лишнее обрезает `overflow`
  diagonalFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: space.s5,
    right: -space.s5,
    transform: [{ skewX: DIAGONAL_SKEW }],
  },
});
