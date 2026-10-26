import type { CatalogRouteCard } from '@pokatim/contracts';
import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { routePlace, routeStats } from '@/features/routes/format';
import { meta } from '@/lib/minsk-format';

export interface RouteListCardProps {
  route: CatalogRouteCard;
  onPress: () => void;
}

/**
 * Карточка маршрута каталога в списке (по образцу `RaceListCard`): название, «86 км · набор 412 м · петля», «Минск ·
 * асфальт, гравий». Для скринридера — одна ссылка «название. цифры · место».
 */
export function RouteListCard({ route, onPress }: RouteListCardProps) {
  const theme = useTheme();
  const stats = routeStats(route);
  const place = routePlace(route);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('routes.card.label', {
        title: route.title,
        details: meta([stats, place]),
      })}
      onPress={onPress}
      style={[styles.card, { borderTopColor: theme.border.subtle }]}
    >
      <Text style={[textStyle('displaySm'), { color: theme.text.primary }]}>{route.title}</Text>
      <Text style={[textStyle('titleSm'), styles.line, { color: theme.text.primary }]}>
        {stats}
      </Text>
      {place ? (
        <Text style={[textStyle('meta'), styles.line, { color: theme.text.secondary }]}>
          {place}
        </Text>
      ) : null}
    </Pressable>
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
});
