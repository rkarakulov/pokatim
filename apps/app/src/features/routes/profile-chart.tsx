import type { CatalogRouteElevation } from '@pokatim/contracts';
import { stroke, type AppTheme } from '@pokatim/design-tokens';
import { StyleSheet, View } from 'react-native';

import { profileBarHeights, profileBars } from './format';
import { PROFILE_FILL_OPACITY } from './profile-style';

/** Столбиков на native: ≈ 2 px при ширине телефона — ступенек не видно, Yoga округляет к пиксельной сетке. */
export const PROFILE_BARS = 160;

/**
 * Площадь профиля на native (routes-03, fix «квадратный и тяжёлый профиль»): узкие столбики `View` в приглушённом
 * цвете `map.corridor` — светлая заливка (`PROFILE_FILL_OPACITY`) и верхняя кромка тонкой линией. Без SVG: новой
 * нативной зависимости нет (старые dev-сборки без модуля упали бы). Web — `profile-chart.web.tsx` (SVG-путь).
 */
export function ProfileChart({
  elevation,
  theme,
}: {
  elevation: CatalogRouteElevation;
  theme: AppTheme;
}) {
  const heights = profileBarHeights(
    profileBars(elevation.profile, PROFILE_BARS),
    elevation.minM,
    elevation.maxM,
  );
  const color = theme.map.corridor;
  return (
    <View style={styles.layers}>
      <View style={[styles.bars, { opacity: PROFILE_FILL_OPACITY }]}>
        {heights.map((height, index) => (
          <View
            // столбики статичны — ключ по позиции
            key={index}
            testID="elevation-profile-bar"
            style={[styles.bar, { height: `${height * 100}%`, backgroundColor: color }]}
          />
        ))}
      </View>
      <View style={[styles.bars, StyleSheet.absoluteFill]}>
        {heights.map((height, index) => (
          <View
            key={index}
            style={[
              styles.bar,
              { height: `${height * 100}%`, borderTopWidth: stroke.input, borderTopColor: color },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layers: { flex: 1 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  bar: { flex: 1 },
});
