import { stroke } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

/**
 * Полоса прогресса `progressbar` на ролях темы: дорожка `border.subtle`, заполнение `text.primary` (толщина
 * `stroke.indicator`). Общая для загрузки файла заезда и «Следующих целей» достижений; в `@rkarakulov/ui` компонента
 * нет — кандидат в базу app-foundation.
 */
export function ProgressBar({
  value,
  max,
  accessibilityLabel,
  testID,
}: {
  value: number;
  /** > 0 */
  max: number;
  accessibilityLabel: string;
  testID?: string;
}) {
  const theme = useTheme();
  const share = Math.min(Math.max(value / max, 0), 1);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max, now: value }}
      style={[styles.track, { backgroundColor: theme.border.subtle }]}
    >
      <View
        testID={testID === undefined ? undefined : `${testID}-fill`}
        style={[
          styles.fill,
          { backgroundColor: theme.text.primary, width: `${Math.round(share * 100)}%` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: stroke.indicator, alignSelf: 'stretch' },
  fill: { height: stroke.indicator },
});
