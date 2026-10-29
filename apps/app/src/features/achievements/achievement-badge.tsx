import type { AchievementCode } from '@pokatim/contracts';
import { radius, space, stroke } from '@pokatim/design-tokens';
import { textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

import { catalogEntry } from './achievement-catalog';

/**
 * Размеры значка «Эмаль» (px): в сетке блока и крупно на вспышке. В базе (`size`) готовых значений нет — follow-up
 * `size.badge*` в app-foundation (task.md 8.2).
 */
export const BADGE_SIZE = { grid: 72, hero: 152 } as const;

/** Доли диаметра: кольцо акцента и диск с иконкой (пропорции эмблемы). */
const RING_INSET = 0.07;
const RING_WIDTH = 0.1;
const DISC = 0.56;
const ICON = 0.28;

/**
 * Значок достижения «Эмаль» (achievements): круг фона с контуром текста, кольцо акцента, диск основного действия с
 * иконкой кода; у счётных («Пять гонок») — число на кольце снизу. Только роли темы; декоративный — подпись даёт
 * родитель (плитка блока, карточка).
 */
export function AchievementBadge({ code, size }: { code: AchievementCode; size: number }) {
  const theme = useTheme();
  const entry = catalogEntry(code);
  const disc = Math.round(size * DISC);
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
            top: size * RING_INSET,
            left: size * RING_INSET,
            right: size * RING_INSET,
            bottom: size * RING_INSET,
            borderWidth: size * RING_WIDTH,
            borderColor: theme.text.accent,
          },
        ]}
      />
      <View
        style={[styles.disc, { width: disc, height: disc, backgroundColor: theme.action.primary }]}
      >
        <Icon name={entry.icon} size={Math.round(size * ICON)} color={theme.action.onPrimary} />
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
