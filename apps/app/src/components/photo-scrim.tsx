import { photoScrimAlpha } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

/** Полос затемнения по высоте: шаг прозрачности ≤ ~0,07 — ступеньки на фото не видны. */
export const PHOTO_SCRIM_BANDS = 48;

const BANDS = Array.from({ length: PHOTO_SCRIM_BANDS }, (_, index) =>
  photoScrimAlpha((index + 0.5) / PHOTO_SCRIM_BANDS),
);

/**
 * Затемнение фото под текстом (ride-photo, ADR-0028): вертикальный градиент `photoScrim` (`@pokatim/design-tokens`,
 * тот же токен, что у карточки 4a) цвета `overlay.scrim` — полосами `View` (одинаково на iOS, Android и web, без
 * `react-native-svg` и нативных модулей). Заполняет родителя, не перехватывает касания, скрыт от скринридера.
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
