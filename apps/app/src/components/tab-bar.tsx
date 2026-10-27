import { size, space, stroke, type AppTheme } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Панель вкладок по прототипу: активная — метка 600 и 2 px полоса по верхнему краю, неактивная — метка 500. Цвета —
 * группа ролей темы `tabBar` (у «Классики» — прежние surface.default / text.primary / text.secondary).
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { tabBar, border } = useTheme<AppTheme>();

  return (
    <View
      accessibilityRole="tablist"
      testID="tab-bar"
      style={[
        styles.bar,
        {
          backgroundColor: tabBar.background,
          borderTopColor: border.subtle,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options;
        const label = options?.title ?? route.name;
        const focused = state.index === index;

        const onPress = () => {
          const event = emitter.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            // aria-*, а не accessibilityState: react-native-web его не переносит в DOM
            aria-selected={focused}
            onPress={onPress}
            style={styles.tab}
          >
            <View
              testID={`tab-indicator-${route.name}`}
              style={[
                styles.indicator,
                { backgroundColor: focused ? tabBar.active : 'transparent' },
              ]}
            />
            <Text
              numberOfLines={1}
              style={[
                textStyle(focused ? 'tabLabelActive' : 'tabLabel'),
                { color: focused ? tabBar.active : tabBar.inactive },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: stroke.hairline },
  tab: {
    flex: 1,
    alignItems: 'center',
    minHeight: size.tabBarHeight,
    paddingBottom: space.s2,
    gap: space.s2,
  },
  indicator: { alignSelf: 'stretch', height: stroke.indicator },
});
