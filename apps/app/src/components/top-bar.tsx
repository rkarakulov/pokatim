import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './icon';
import { NotificationBell } from './notification-bell';

interface TopBarProps {
  /** вход в центр уведомлений — колокольчик первым справа (notifications); без обработчика колокольчика нет */
  onOpenNotifications?: () => void;
  /** непрочитанные для счётчика колокольчика; неизвестно — без счётчика */
  unreadCount?: number;
  /** вход в «Устройства» — иконка справа (место будущего аватара «Личная линия»); без обработчика иконки нет */
  onOpenDevices?: () => void;
  /** вход в «Настройки» (settings-hub) — иконка справа после «Устройств»; без обработчика иконки нет */
  onOpenSettings?: () => void;
}

/**
 * Верхняя панель корня вкладки (`.topbar` прототипа): словесный знак продукта, иконки «Устройства» (часы) и «Настройки»
 * (`Icon`: SF Symbols на iOS, Material Symbols на Android и web), колокольчик уведомлений со счётчиком.
 * Аватар — с блоком профиля; тогда же — кандидат в `@rkarakulov/ui` (R8 блока 02).
 */
export function TopBar({
  onOpenNotifications,
  unreadCount,
  onOpenDevices,
  onOpenSettings,
}: TopBarProps) {
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
        {onOpenNotifications ? (
          <NotificationBell count={unreadCount} onPress={onOpenNotifications} />
        ) : null}
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
        {onOpenSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.title')}
            onPress={onOpenSettings}
            hitSlop={space.s2}
            style={styles.action}
          >
            <Icon name="settings" size={size.icon} color={theme.text.primary} />
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
