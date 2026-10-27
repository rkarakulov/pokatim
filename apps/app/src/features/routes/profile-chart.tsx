import type { CatalogRouteElevation } from '@pokatim/contracts';
import type { AppTheme } from '@pokatim/design-tokens';
import { StyleSheet, View } from 'react-native';

import { profileBarHeights, profileBars } from './format';
import { PROFILE_NATIVE_FILL_OPACITY } from './profile-style';

/** Столбиков на native: ≈ 2 px при ширине телефона — ступенек не видно, Yoga округляет к пиксельной сетке. */
export const PROFILE_BARS = 160;

/**
 * Площадь профиля на native (routes-03, fix «квадратный и тяжёлый профиль»): узкие столбики `View` в приглушённом
 * цвете `map.corridor` — светлый силуэт (`PROFILE_NATIVE_FILL_OPACITY`) без кромки (кромка из отдельных столбиков
 * ступенчатая). Без SVG: новой нативной зависимости нет (старые dev-сборки без модуля упали бы). Web —
 * `profile-chart.web.tsx` (SVG-путь: линия + заливка).
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
    <View style={[styles.bars, { opacity: PROFILE_NATIVE_FILL_OPACITY }]}>
      {heights.map((height, index) => (
        <View
          // столбики статичны — ключ по позиции
          key={index}
          testID="elevation-profile-bar"
          style={[styles.bar, { height: `${height * 100}%`, backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  bar: { flex: 1 },
});
