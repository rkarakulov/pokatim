import { motion, size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

export interface MapControlsProps {
  theme: AppTheme;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** «в рамку» — камера по рамке маршрута (и трека) */
  onFit: () => void;
}

/**
 * Кнопки камеры карты (routes-04b, RC-5…RC-7): колонка сверху справа — «+», «−», «в рамку» (видна всегда); атрибуция
 * «i» — снизу справа, не пересекаются. Иконки — `expo-symbols` (SF Symbols / Material Symbols), цель `size.touchMin`.
 * Локальный компонент: `IconButton` в `@rkarakulov/ui` нет (follow-up в app-foundation, второй потребитель — `TopBar`).
 * Без RNGH — идёт и в web-бандл.
 */
export function MapControls({ theme, onZoomIn, onZoomOut, onFit }: MapControlsProps) {
  const buttons: {
    testID: string;
    label: string;
    icon: SymbolViewProps['name'];
    onPress: () => void;
  }[] = [
    {
      testID: 'map-zoom-in',
      label: t('maps.controls.zoomIn'),
      icon: { ios: 'plus', android: 'add', web: 'add' },
      onPress: onZoomIn,
    },
    {
      testID: 'map-zoom-out',
      label: t('maps.controls.zoomOut'),
      icon: { ios: 'minus', android: 'remove', web: 'remove' },
      onPress: onZoomOut,
    },
    {
      testID: 'map-fit',
      label: t('maps.controls.fit'),
      icon: { ios: 'arrow.up.left.and.arrow.down.right', android: 'fit_screen', web: 'fit_screen' },
      onPress: onFit,
    },
  ];
  return (
    <View testID="map-controls" style={styles.column}>
      {buttons.map((button) => (
        <Pressable
          key={button.testID}
          testID={button.testID}
          accessibilityRole="button"
          accessibilityLabel={button.label}
          onPress={button.onPress}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: theme.surface.raised,
              borderColor: theme.border.subtle,
              opacity: pressed ? motion.pressedOpacity : 1,
            },
          ]}
        >
          <SymbolView name={button.icon} size={size.icon} tintColor={theme.text.primary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { position: 'absolute', top: space.s2, right: space.s2, gap: space.s1 },
  button: {
    width: size.touchMin,
    height: size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: stroke.hairline,
  },
});
