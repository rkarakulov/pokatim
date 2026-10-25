import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Верхняя панель корня вкладки (`.topbar` прототипа): словесный знак продукта. Колокольчик и аватар «Личная линия» —
 * с блоками уведомлений и профиля; тогда же — кандидат в `@rkarakulov/ui` (R8 блока 02).
 */
export function TopBar() {
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
});
