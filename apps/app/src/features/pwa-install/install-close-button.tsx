import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/icon';

/** «×» плашки, инструкции и промо установки: цель касания — `touchMin`. */
export function InstallCloseButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('pwaInstall.close')}
      onPress={onPress}
      hitSlop={space.s2}
      style={styles.button}
    >
      <Icon name="close" size={size.icon} color={theme.text.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
