import { size, space, stroke, type AppTheme, type AppThemeLayout } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/use-app-theme';

import { Icon, type IconName } from './icon';

/** Вкладки приложения (`src/app/(tabs)/_layout.tsx`; равенство сторожит `theme-guards.test.ts`). */
export const TAB_NAMES = ['index', 'races', 'rides', 'routes', 'calendar'] as const;
type TabName = (typeof TAB_NAMES)[number];

/** Иконки вкладок (вариант `icons`): полноту по вкладкам проверяет тип. */
const TAB_ICONS: Record<TabName, IconName> = {
  index: 'home',
  races: 'races',
  rides: 'rides',
  routes: 'routes',
  calendar: 'calendar',
};

const isTabName = (name: string): name is TabName =>
  (TAB_NAMES as readonly string[]).includes(name);

interface TabItemProps {
  name: string;
  label: string;
  focused: boolean;
  tabBar: AppTheme['tabBar'];
}

/** «Классика»: 2 px полоса по верхнему краю у активной и подпись. */
function ClassicTabItem({ name, label, focused, tabBar }: TabItemProps) {
  return (
    <>
      <View
        testID={`tab-indicator-${name}`}
        style={[styles.indicator, { backgroundColor: focused ? tabBar.active : 'transparent' }]}
      />
      <TabLabel label={label} focused={focused} tabBar={tabBar} />
    </>
  );
}

/** Темы с иконками: иконка над подписью, полосы нет; активная — с заливкой (iOS). Иконка декоративная. */
function IconTabItem({ name, label, focused, tabBar }: TabItemProps) {
  // незнакомое имя (тестовый навигатор) — только подпись
  const icon = isTabName(name) ? TAB_ICONS[name] : null;
  return (
    <View style={styles.iconItem}>
      {icon ? (
        <Icon
          name={icon}
          size={size.icon}
          color={focused ? tabBar.active : tabBar.inactive}
          filled={focused}
        />
      ) : null}
      <TabLabel label={label} focused={focused} tabBar={tabBar} />
    </View>
  );
}

function TabLabel({ label, focused, tabBar }: Omit<TabItemProps, 'name'>) {
  return (
    <Text
      numberOfLines={1}
      style={[
        textStyle(focused ? 'tabLabelActive' : 'tabLabel'),
        { color: focused ? tabBar.active : tabBar.inactive },
      ]}
    >
      {label}
    </Text>
  );
}

/** Вариант вкладки по раскладке темы (`layout.tabBar`, app-themes C2). */
const TAB_ITEM: Record<AppThemeLayout['tabBar'], ComponentType<TabItemProps>> = {
  classic: ClassicTabItem,
  icons: IconTabItem,
};

/**
 * Панель вкладок по прототипу: активная — метка 600, неактивная — метка 500; у «Классики» — 2 px полоса по верхнему
 * краю, у тем — иконка над подписью. Цвета — группа ролей темы `tabBar` (у «Классики» — прежние surface.default /
 * text.primary / text.secondary).
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { tabBar, border } = useTheme<AppTheme>();
  const Item = TAB_ITEM[useAppTheme().layout.tabBar];

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
            <Item name={route.name} label={label} focused={focused} tabBar={tabBar} />
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
  iconItem: { alignItems: 'center', paddingTop: space.s2, gap: space.s1 },
});
