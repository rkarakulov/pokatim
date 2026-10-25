import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface TopBarProps {
  /** вход в «Устройства» — иконка справа (место будущего аватара «Личная линия»); без обработчика иконки нет */
  onOpenDevices?: () => void;
}

/**
 * Верхняя панель корня вкладки (`.topbar` прототипа): словесный знак продукта и иконка «Устройства» (часы: SF Symbols
 * на iOS, Material Symbols на Android и web — `expo-symbols`). Колокольчик и аватар — с блоками уведомлений и профиля;
 * тогда же — кандидат в `@rkarakulov/ui` (R8 блока 02).
 */
export function TopBar({ onOpenDevices }: TopBarProps) {
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
      {onOpenDevices ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('devices.title')}
          onPress={onOpenDevices}
          hitSlop={space.s2}
          style={styles.action}
        >
          <SymbolView
            name={{ ios: 'applewatch', android: 'watch', web: 'watch' }}
            size={size.icon}
            tintColor={theme.text.primary}
          />
        </Pressable>
      ) : null}
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
  action: {
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
