import type { CatalogRouteCard, MyRoute } from '@pokatim/contracts';
import {
  appDensity,
  shapeOf,
  size,
  space,
  stroke,
  type AppTheme,
  type AppThemeLayout,
} from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Pill, SkeletonText, textStyle, useTheme, type PillTone } from '@rkarakulov/ui';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { routeHeroDate, routePlace, routeStats } from '@/features/routes/format';
import { myRouteStats, myRouteStatus, myRouteUploadedAt } from '@/features/routes/my-route-format';
import { meta, type HeroDate } from '@/lib/minsk-format';
import { useAppTheme } from '@/theme/use-app-theme';

import { Icon } from './icon';

interface RouteCardFrameProps {
  title: string;
  stats: string | null;
  status: { label: string; tone: PillTone } | null;
  secondary: string | null;
  /** дистанция крупно (вариант `numeral`); `null` — дистанции нет (свой маршрут в обработке или с отказом) */
  numeral: HeroDate | null;
  label: string;
  onPress: () => void;
}

/** Строки карточки: название, строка цифр (или статус `Pill` вместо неё), вторая строка. */
function CardLines({
  title,
  stats,
  status,
  secondary,
  caps = false,
}: Pick<RouteCardFrameProps, 'title' | 'stats' | 'status' | 'secondary'> & { caps?: boolean }) {
  const theme = useTheme();
  return (
    <>
      <Text
        style={[textStyle('displaySm'), caps ? styles.caps : null, { color: theme.text.primary }]}
      >
        {title}
      </Text>
      {status ? (
        <View style={[styles.line, styles.pill]}>
          <Pill label={status.label} tone={status.tone} />
        </View>
      ) : stats ? (
        <Text style={[textStyle('titleSm'), styles.line, { color: theme.text.primary }]}>
          {stats}
        </Text>
      ) : null}
      {secondary ? (
        <Text style={[textStyle('meta'), styles.line, { color: theme.text.secondary }]}>
          {secondary}
        </Text>
      ) : null}
    </>
  );
}

/** Шеврон «перейти» карточки-плитки: декоративный, скрыт от скринридера (ссылка — вся карточка). */
function Chevron() {
  const theme = useTheme();
  return (
    <View
      testID="route-card-chevron"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Icon name="chevronRight" size={size.icon} color={theme.text.secondary} />
    </View>
  );
}

/** Отступ и зазор карточки — плотность темы (`appDensity`). */
const useDensity = () => appDensity[useAppTheme().density];

/** «Классика»: hairline сверху, строки карточки. */
function ClassicCard({ label, onPress, ...lines }: RouteCardFrameProps) {
  const theme = useTheme();
  const { cardPadding } = useDensity();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.card, { borderTopColor: theme.border.subtle, paddingVertical: cardPadding }]}
    >
      <CardLines {...lines} />
    </Pressable>
  );
}

/** Стиль карточки-плитки: `surface.raised`, радиус `shape.card`, отступ и зазор плотности. */
function useTileStyle() {
  const theme = useTheme<AppTheme>();
  const { cardPadding, listGap } = useDensity();
  return {
    backgroundColor: theme.surface.raised,
    borderRadius: shapeOf(theme).card,
    padding: cardPadding,
    marginBottom: listGap,
  };
}

/** Плитка (Атлас, Хронометр, Журнал, Навигация): карточка со строками и шевроном справа. */
function TileCard({ label, onPress, ...lines }: RouteCardFrameProps) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, useTileStyle()]}
    >
      <View style={styles.body}>
        <CardLines {...lines} />
      </View>
      <Chevron />
    </Pressable>
  );
}

/**
 * Крупная цифра (Типографика): слева дистанция `displayNumeral44` с единицей, справа название заглавными, мета и
 * шеврон. Дистанции нет — тело как у плитки (развилка по данным).
 */
function NumeralCard(props: RouteCardFrameProps) {
  const theme = useTheme();
  const tile = useTileStyle();
  const { numeral, label, onPress, ...lines } = props;
  if (!numeral) return <TileCard {...props} />;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.row, tile]}
    >
      <View testID="route-card-numeral" style={styles.numeral}>
        <Text style={[textStyle('displayNumeral44'), { color: theme.text.primary }]}>
          {numeral.value}
        </Text>
        {numeral.unit ? (
          <Text style={[textStyle('unit'), { color: theme.text.secondary }]}>{numeral.unit}</Text>
        ) : null}
      </View>
      <View style={styles.body}>
        <CardLines {...lines} caps />
      </View>
      <Chevron />
    </Pressable>
  );
}

/** Тело карточки по раскладке темы (`layout.routeCard`, app-themes C2). */
const ROUTE_CARD: Record<AppThemeLayout['routeCard'], ComponentType<RouteCardFrameProps>> = {
  classic: ClassicCard,
  tile: TileCard,
  numeral: NumeralCard,
};

/** Общая рамка карточки маршрута в списке: вариант — по теме. Для скринридера — одна ссылка `label`. */
function RouteCardFrame(props: RouteCardFrameProps) {
  const Card = ROUTE_CARD[useAppTheme().layout.routeCard];
  return <Card {...props} />;
}

export interface RouteListCardProps {
  route: CatalogRouteCard;
  onPress: () => void;
}

/**
 * Карточка маршрута каталога в списке (по образцу `RaceListCard`): название, «86 км · набор 412 м · петля», «Минск ·
 * асфальт, гравий». Для скринридера — одна ссылка «название. цифры · место».
 */
export function RouteListCard({ route, onPress }: RouteListCardProps) {
  const stats = routeStats(route);
  const place = routePlace(route);
  return (
    <RouteCardFrame
      title={route.title}
      stats={stats}
      status={null}
      secondary={place || null}
      numeral={routeHeroDate(route)}
      label={t('routes.card.label', { title: route.title, details: meta([stats, place]) })}
      onPress={onPress}
    />
  );
}

/**
 * Карточка своего маршрута (routes-02): готовый — цифры и дата загрузки; «Обрабатывается» и отказ — статус `Pill`
 * вместо цифр (причина отказа — текстом). Для скринридера — «название. статус или цифры · дата».
 */
export function MyRouteListCard({ route, onPress }: { route: MyRoute; onPress: () => void }) {
  const stats = myRouteStats(route);
  const status = myRouteStatus(route);
  const uploadedAt = myRouteUploadedAt(route);
  return (
    <RouteCardFrame
      title={route.title}
      stats={stats}
      status={status}
      secondary={uploadedAt}
      numeral={route.distanceM === null ? null : routeHeroDate({ distanceM: route.distanceM })}
      label={t('routes.mine.card.label', {
        title: route.title,
        details: meta([status?.label ?? stats, uploadedAt]),
      })}
      onPress={onPress}
    />
  );
}

function SkeletonLines() {
  return (
    <>
      <SkeletonText variant="displaySm" lines={1} lastLineWidth="70%" />
      <SkeletonText variant="titleSm" lines={1} lastLineWidth="55%" />
      <SkeletonText variant="meta" lines={1} lastLineWidth="40%" />
    </>
  );
}

function ClassicSkeleton() {
  const theme = useTheme();
  const { cardPadding } = useDensity();
  return (
    <View
      testID="route-card-skeleton-classic"
      style={[
        styles.card,
        styles.skeleton,
        { borderTopColor: theme.border.subtle, paddingVertical: cardPadding },
      ]}
    >
      <SkeletonLines />
    </View>
  );
}

function TileSkeleton() {
  return (
    <View testID="route-card-skeleton-tile" style={[styles.skeleton, useTileStyle()]}>
      <SkeletonLines />
    </View>
  );
}

function NumeralSkeleton() {
  return (
    <View testID="route-card-skeleton-numeral" style={[styles.row, useTileStyle()]}>
      <View style={styles.numeral}>
        <SkeletonText variant="displayNumeral44" lines={1} lastLineWidth={size.rowMin} />
      </View>
      <View style={[styles.body, styles.skeleton]}>
        <SkeletonLines />
      </View>
    </View>
  );
}

/** Скелетон карточки повторяет вариант темы. */
const ROUTE_CARD_SKELETON: Record<AppThemeLayout['routeCard'], ComponentType> = {
  classic: ClassicSkeleton,
  tile: TileSkeleton,
  numeral: NumeralSkeleton,
};

/** Скелетон карточки (первая загрузка, догрузка страницы): раскладка карточки варианта темы. */
export function RouteListCardSkeleton() {
  const Skeleton = ROUTE_CARD_SKELETON[useAppTheme().layout.routeCard];
  return <Skeleton />;
}

const styles = StyleSheet.create({
  skeleton: { gap: space.s2 },
  // отступ по вертикали — плотность темы (`appDensity`)
  card: { borderTopWidth: stroke.hairline },
  line: { marginTop: space.s1 },
  pill: { alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', columnGap: space.s3 },
  body: { flex: 1, minWidth: 0 },
  numeral: { flexDirection: 'row', alignItems: 'baseline', columnGap: space.s1 },
  caps: { textTransform: 'uppercase' },
});
