import type { AppThemeId } from '@pokatim/contracts';
import { size, space, stroke, THEME_PREVIEWS, type ThemePreviewMock } from '@pokatim/design-tokens';
import { StyleSheet, View } from 'react-native';

/**
 * Превью темы в списке выбора (user-theme A12): мини-макет экрана на каждую схему темы — у «по системе» светлый и тёмный
 * рядом, у «всегда тёмной» один. Фон экрана, карточка с плашкой заголовка, полоса маршрута и плашка кнопки — цвета и
 * радиус из реестра (`THEME_PREVIEWS`), размеры — токены. Без SVG (на native `react-native-svg` — только лениво) и без
 * шрифтов темы. Скрыто от скринридера: смысл несут название и описание строки.
 */
export function ThemePreview({ themeId }: { themeId: AppThemeId }) {
  return (
    <View
      testID="theme-preview"
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={styles.row}
    >
      {THEME_PREVIEWS[themeId].mocks.map((mock, index) => (
        <Mock key={index} mock={mock} />
      ))}
    </View>
  );
}

function Mock({ mock }: { mock: ThemePreviewMock }) {
  return (
    <View testID="theme-preview-mock" style={[styles.mock, { backgroundColor: mock.canvas }]}>
      <View style={[styles.card, { backgroundColor: mock.card, borderRadius: mock.radius }]}>
        <View style={[styles.title, { backgroundColor: mock.text }]} />
        <View style={[styles.route, { backgroundColor: mock.route }]} />
      </View>
      <View style={[styles.button, { backgroundColor: mock.accent, borderRadius: mock.radius }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.s1 },
  mock: {
    width: size.avatar,
    height: size.emptyTile,
    padding: space.s1,
    gap: space.s1,
    justifyContent: 'space-between',
  },
  card: { padding: space.s1, gap: space.s1 },
  title: { height: space.s1, width: '70%' },
  route: { height: stroke.indicator },
  button: { height: space.s2 },
});
