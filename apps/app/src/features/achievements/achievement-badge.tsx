import type { AchievementCode } from '@pokatim/contracts';
import { badgeShape, radius, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

import { catalogEntry } from './achievement-catalog';

/**
 * Значок достижения «Эмаль» (achievements): круг фона с контуром текста, кольцо акцента, диск основного действия с
 * иконкой кода; у счётных («Пять гонок») — число на кольце снизу. Диаметр — `layout.badgeGrid` / `layout.badgeHero`,
 * пропорции — `badgeShape` (`@pokatim/design-tokens`), цвета — роли темы. Декоративный: подпись даёт родитель.
 */
export function AchievementBadge({ code, size }: { code: AchievementCode; size: number }) {
  const theme = useTheme();
  const entry = catalogEntry(code);
  const disc = Math.round(size * badgeShape.disc);
  return (
    <View
      testID={`achievement-badge-${code}`}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.outer,
        {
          width: size,
          height: size,
          backgroundColor: theme.surface.default,
          borderColor: theme.text.primary,
        },
      ]}
    >
      <View
        style={[
          styles.ring,
          {
            top: size * badgeShape.ringInset,
            left: size * badgeShape.ringInset,
            right: size * badgeShape.ringInset,
            bottom: size * badgeShape.ringInset,
            borderWidth: size * badgeShape.ringWidth,
            borderColor: theme.text.accent,
          },
        ]}
      />
      <View
        style={[styles.disc, { width: disc, height: disc, backgroundColor: theme.action.primary }]}
      >
        <Icon
          name={entry.icon}
          size={Math.round(size * badgeShape.icon)}
          color={theme.action.onPrimary}
        />
      </View>
      {entry.count !== undefined ? (
        <View style={[styles.count, { backgroundColor: theme.surface.default }]}>
          <Text style={[textStyle('label'), { color: theme.text.primary }]}>{entry.count}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderRadius: radius.pill,
    borderWidth: stroke.indicator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', borderRadius: radius.pill },
  disc: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', bottom: 0, paddingHorizontal: space.s1 },
});
