import { photoScrimAlpha, photoScrimHero } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

/** Полос затемнения по высоте: шаг прозрачности ≤ ~0,03 — ступеньки на фото не видны. */
export const PHOTO_SCRIM_BANDS = 48;

const BANDS = Array.from({ length: PHOTO_SCRIM_BANDS }, (_, index) =>
  photoScrimAlpha((index + 0.5) / PHOTO_SCRIM_BANDS, photoScrimHero),
);

/**
 * Затемнение фото героя под текстом (ride-photo, ADR-0028): вертикальный градиент `photoScrimHero`
 * (`@pokatim/design-tokens`; у карточки 4a — свой профиль `photoScrim`) цвета `overlay.scrim` — полосами `View`
 * (одинаково на iOS, Android и web, без `react-native-svg` и нативных модулей). Заполняет родителя, не перехватывает
 * касания, скрыт от скринридера.
 */
export function PhotoScrim() {
  const theme = useTheme();
  return (
    <View
      testID="photo-scrim"
      pointerEvents="none"
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      {BANDS.map((alpha, index) => (
        <View
          key={index}
          testID="photo-scrim-band"
          style={[styles.band, { backgroundColor: theme.overlay.scrim, opacity: alpha }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ band: { flex: 1 } });
