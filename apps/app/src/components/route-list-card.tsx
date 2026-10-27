import type { CatalogRouteCard, MyRoute } from '@pokatim/contracts';
import { appDensity, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Pill, SkeletonText, textStyle, useTheme, type PillTone } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { routePlace, routeStats } from '@/features/routes/format';
import { myRouteStats, myRouteStatus, myRouteUploadedAt } from '@/features/routes/my-route-format';
import { meta } from '@/lib/minsk-format';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Общая рамка карточки маршрута в списке: название, строка цифр (или статус `Pill` вместо неё), вторая строка.
 * Для скринридера — одна ссылка `label`.
 */
function RouteCardFrame({
  title,
  stats,
  status,
  secondary,
  label,
  onPress,
}: {
  title: string;
  stats: string | null;
  status: { label: string; tone: PillTone } | null;
  secondary: string | null;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { cardPadding } = appDensity[useAppTheme().density];
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.card, { borderTopColor: theme.border.subtle, paddingVertical: cardPadding }]}
    >
      <Text style={[textStyle('displaySm'), { color: theme.text.primary }]}>{title}</Text>
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
    </Pressable>
  );
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
      label={t('routes.mine.card.label', {
        title: route.title,
        details: meta([status?.label ?? stats, uploadedAt]),
      })}
      onPress={onPress}
    />
  );
}

/** Скелетон карточки (первая загрузка, догрузка страницы): название, цифры, место — раскладка карточки. */
export function RouteListCardSkeleton() {
  const theme = useTheme();
  const { cardPadding } = appDensity[useAppTheme().density];
  return (
    <View
      style={[
        styles.card,
        styles.skeleton,
        { borderTopColor: theme.border.subtle, paddingVertical: cardPadding },
      ]}
    >
      <SkeletonText variant="displaySm" lines={1} lastLineWidth="70%" />
      <SkeletonText variant="titleSm" lines={1} lastLineWidth="55%" />
      <SkeletonText variant="meta" lines={1} lastLineWidth="40%" />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: space.s2 },
  // отступ по вертикали — плотность темы (`appDensity`)
  card: { borderTopWidth: stroke.hairline },
  line: { marginTop: space.s1 },
  pill: { alignItems: 'flex-start' },
});
