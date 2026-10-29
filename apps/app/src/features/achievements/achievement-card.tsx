import type { PublicRiderAchievement } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { textStyle, useReducedMotion, useTheme } from '@rkarakulov/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import {
  achievementCondition,
  achievementObjectText,
  achievementTitle,
  factDateText,
  type KnownAchievement,
} from './achievement-catalog';
import { AchievementBadge, BADGE_SIZE } from './achievement-badge';

/** Появление значка на вспышке: из 0,6 в 1 с прозрачностью — одно движение, без мерцания и повторов. */
export const FLASH_ENTER_MS = 420;
const FLASH_FROM_SCALE = 0.6;

/**
 * Появление значка вспышки. Анимация — только при `useReducedMotion() === false`: «Уменьшить движение» и ещё
 * неизвестный ответ системы — статичный значок (AC13).
 */
function BadgeEnter({ animated, children }: { animated: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const animate = animated && reduced === false;
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!animate) return;
    progress.setValue(0);
    const enter = Animated.timing(progress, {
      toValue: 1,
      duration: FLASH_ENTER_MS,
      easing: Easing.out(Easing.cubic),
      // opacity и transform; на web нативного драйвера нет
      useNativeDriver: false,
    });
    enter.start();
    return () => enter.stop();
  }, [animate, progress]);
  if (!animate) return <View testID="achievement-badge-static">{children}</View>;
  return (
    <Animated.View
      testID="achievement-badge-animated"
      style={{
        opacity: progress,
        transform: [
          {
            scale: progress.interpolate({ inputRange: [0, 1], outputRange: [FLASH_FROM_SCALE, 1] }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Общий макет вспышки и экрана достижения (A5, A6): крупный значок, название, условие, объект (гонка, маршрут или
 * райд), дата факта; действия — снизу (`children`). Дата — день по Минску с годом (RC-7, SSR = первый рендер).
 */
export function AchievementCard({
  item,
  animated = false,
  children,
}: {
  item: KnownAchievement<PublicRiderAchievement>;
  animated?: boolean;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View testID="achievement-card" style={styles.card}>
      <BadgeEnter animated={animated}>
        <AchievementBadge code={item.code} size={BADGE_SIZE.hero} />
      </BadgeEnter>
      <View style={styles.text}>
        <Text
          accessibilityRole="header"
          style={[textStyle('displaySm'), styles.center, { color: theme.text.primary }]}
        >
          {achievementTitle(item.code)}
        </Text>
        <Text style={[textStyle('body'), styles.center, { color: theme.text.secondary }]}>
          {achievementCondition(item.code)}
        </Text>
        <Text style={[textStyle('bodyStrong'), styles.center, { color: theme.text.primary }]}>
          {achievementObjectText(item.object)}
        </Text>
        <Text style={[textStyle('meta'), styles.center, { color: theme.text.secondary }]}>
          {factDateText(item.factDate)}
        </Text>
      </View>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: space.s5 },
  text: { alignItems: 'center', gap: space.s2 },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: space.s3 },
});
