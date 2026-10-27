import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './icon';

interface TopBarProps {
  /** вход в «Устройства» — иконка справа (место будущего аватара «Личная линия»); без обработчика иконки нет */
  onOpenDevices?: () => void;
  /** вход в «Профиль» (profile-rider-name) — иконка справа после «Устройств»; без обработчика иконки нет */
  onOpenProfile?: () => void;
}

/**
 * Верхняя панель корня вкладки (`.topbar` прототипа): словесный знак продукта, иконки «Устройства» (часы) и «Профиль»
 * (`Icon`: SF Symbols на iOS, Material Symbols на Android и web). Колокольчик и аватар — с блоками уведомлений
 * и профиля; тогда же — кандидат в `@rkarakulov/ui` (R8 блока 02).
 */
export function TopBar({ onOpenDevices, onOpenProfile }: TopBarProps) {
  const theme = useTheme();
  return (
    <View testID="top-bar" style={styles.bar}>
      <Text
        accessibilityRole="header"
        accessibilityLabel={t('app.name')}
        style={[textStyle('brand'), { color: theme.text.primary }]}
      >
        {t('home.wordmark')}
      </Text>
      <View style={styles.actions}>
        {onOpenDevices ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('devices.title')}
            onPress={onOpenDevices}
            hitSlop={space.s2}
            style={styles.action}
          >
            <Icon name="watch" size={size.icon} color={theme.text.primary} />
          </Pressable>
        ) : null}
        {onOpenProfile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.title')}
            onPress={onOpenProfile}
            hitSlop={space.s2}
            style={styles.action}
          >
            <Icon name="profile" size={size.icon} color={theme.text.primary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: size.topBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: size.gutter,
    paddingRight: space.s2,
  },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: {
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
