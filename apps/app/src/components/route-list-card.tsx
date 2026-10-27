import type { CatalogRouteCard, MyRoute } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Pill, SkeletonText, textStyle, useTheme, type PillTone } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { routeAuthorLabel, routePlace, routeStats } from '@/features/routes/format';
import {
  myRoutePublicationStatus,
  myRouteStats,
  myRouteStatus,
  myRouteUploadedAt,
} from '@/features/routes/my-route-format';
import { meta } from '@/lib/minsk-format';

type CardPill = { label: string; tone: PillTone };

/**
 * Общая рамка карточки маршрута в списке: название, строка цифр (или статус `Pill` вместо неё), вторая строка, бейдж
 * (routes-06: автор в каталоге, статус заявки в «Моих»). Для скринридера — одна ссылка `label`.
 */
function RouteCardFrame({
  title,
  stats,
  status,
  secondary,
  badge,
  label,
  onPress,
}: {
  title: string;
  stats: string | null;
  status: CardPill | null;
  secondary: string | null;
  badge: CardPill | null;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.card, { borderTopColor: theme.border.subtle }]}
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
      {badge ? (
        <View style={[styles.line, styles.pill]}>
          <Pill label={badge.label} tone={badge.tone} />
        </View>
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
 * асфальт, гравий», у маршрута райдера — бейдж «От райдера» (с именем по U3). Для скринридера — одна ссылка
 * «название. цифры · место · автор».
 */
export function RouteListCard({ route, onPress }: RouteListCardProps) {
  const stats = routeStats(route);
  const place = routePlace(route);
  const author = routeAuthorLabel(route);
  return (
    <RouteCardFrame
      title={route.title}
      stats={stats}
      status={null}
      secondary={place || null}
      badge={author ? { label: author, tone: 'accent' } : null}
      label={t('routes.card.label', {
        title: route.title,
        details: meta([stats, place || null, author]),
      })}
      onPress={onPress}
    />
  );
}

/**
 * Карточка своего маршрута (routes-02): готовый — цифры и дата загрузки; «Обрабатывается» и отказ — статус `Pill`
 * вместо цифр (причина отказа — текстом); routes-06 — статус заявки в каталог бейджем. Для скринридера — «название.
 * статус или цифры · дата · статус заявки».
 */
export function MyRouteListCard({ route, onPress }: { route: MyRoute; onPress: () => void }) {
  const stats = myRouteStats(route);
  const status = myRouteStatus(route);
  const uploadedAt = myRouteUploadedAt(route);
  const publication = myRoutePublicationStatus(route);
  return (
    <RouteCardFrame
      title={route.title}
      stats={stats}
      status={status}
      secondary={uploadedAt}
      badge={publication}
      label={t('routes.mine.card.label', {
        title: route.title,
        details: meta([status?.label ?? stats, uploadedAt, publication?.label ?? null]),
      })}
      onPress={onPress}
    />
  );
}

/** Скелетон карточки (первая загрузка, догрузка страницы): название, цифры, место — раскладка карточки. */
export function RouteListCardSkeleton() {
  const theme = useTheme();
  return (
    <View style={[styles.card, styles.skeleton, { borderTopColor: theme.border.subtle }]}>
      <SkeletonText variant="displaySm" lines={1} lastLineWidth="70%" />
      <SkeletonText variant="titleSm" lines={1} lastLineWidth="55%" />
      <SkeletonText variant="meta" lines={1} lastLineWidth="40%" />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: space.s2 },
  card: { borderTopWidth: stroke.hairline, paddingVertical: space.s4 },
  line: { marginTop: space.s1 },
  pill: { alignItems: 'flex-start' },
});
