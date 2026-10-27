import type { CatalogRouteElevation } from '@pokatim/contracts';
import { space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { profileRangeLabel, profileSummary, profileTicks } from './format';
import { ProfileChart } from './profile-chart';

/** Пропорция графика (раскладка, не px — как `MAP_ASPECT_RATIO`): ≈ 86 при ширине телефона. */
export const PROFILE_ASPECT_RATIO = 4;

/** Подпись оси X правее этой доли длины — выравнивание по правому краю (не выходит за край графика). */
const TICK_ALIGN_END_FROM = 0.85;

/**
 * Профиль высоты маршрута (routes-03, P4, RC-7): заголовок, диапазон «191–267 м» справа, площадь `ProfileChart`
 * (web — плавный SVG-путь, native — узкие столбики; тонкая линия и светлая заливка в приглушённом цвете, без
 * `onLayout` — SSR и первый клиентский рендер совпадают), подписи оси X в км. Для скринридера — один
 * элемент-изображение с текстовой альтернативой, график скрыт. Профиля нет — блока нет.
 */
export function ElevationProfile({
  elevation,
  distanceM,
  gainM,
}: {
  elevation: CatalogRouteElevation | null;
  distanceM: number;
  gainM: number | null;
}) {
  const theme = useTheme<AppTheme>();
  if (elevation === null) return null;
  const ticks = profileTicks(distanceM);
  const muted = { color: theme.text.secondary };
  return (
    <View testID="elevation-profile" style={styles.block}>
      <View style={styles.head}>
        <Text
          accessibilityRole="header"
          style={[textStyle('displaySm'), styles.title, { color: theme.text.primary }]}
        >
          {t('routes.detail.profile.title')}
        </Text>
        <Text style={[textStyle('label'), muted]}>{profileRangeLabel(elevation)}</Text>
      </View>
      <View
        testID="elevation-profile-chart"
        accessible
        accessibilityRole="image"
        accessibilityLabel={profileSummary(elevation, gainM)}
        style={[styles.chart, { borderBottomColor: theme.border.subtle }]}
      >
        <View
          style={styles.area}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <ProfileChart elevation={elevation} theme={theme} />
        </View>
      </View>
      <View
        style={styles.axis}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {ticks.map((tick) => (
          <Text
            key={tick.km}
            style={[
              textStyle('label'),
              muted,
              styles.tick,
              tick.position > TICK_ALIGN_END_FROM
                ? { right: `${(1 - tick.position) * 100}%` }
                : { left: `${tick.position * 100}%` },
            ]}
          >
            {tick.label}
          </Text>
        ))}
        {/* высота строки подписей — невидимый образец (подписи позиционированы абсолютно) */}
        <Text style={[textStyle('label'), styles.spacer]}> </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s2 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { flexShrink: 1 },
  chart: { width: '100%', aspectRatio: PROFILE_ASPECT_RATIO, borderBottomWidth: stroke.hairline },
  area: { flex: 1 },
  axis: { position: 'relative', width: '100%' },
  tick: { position: 'absolute', top: 0 },
  spacer: { opacity: 0 },
});
