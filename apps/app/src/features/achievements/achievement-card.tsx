import type { PublicRiderAchievement } from '@pokatim/contracts';
import { layout, radius, space } from '@pokatim/design-tokens';
import {
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  textStyle,
  useReducedMotion,
  useTheme,
} from '@rkarakulov/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import {
  achievementCondition,
  achievementObjectText,
  achievementTitle,
  factDateText,
  itemLevelLabel,
  type KnownAchievement,
} from './achievement-catalog';
import { AchievementBadge } from './achievement-badge';

/** Появление значка на вспышке: из 0,6 в 1 с прозрачностью — одно движение, без мерцания и повторов. */
export const FLASH_ENTER_MS = 420;
const FLASH_FROM_SCALE = 0.6;

/**
 * Последний известный ответ «Уменьшить движение» в этом процессе: следующий элемент очереди (новый экземпляр, `key`)
 * не ждёт системный ответ заново.
 */
let knownReduced: boolean | null = null;

/**
 * Появление значка вспышки (AC13, LOW-1 ревью). Анимация — только при «Уменьшить движение» выключено; включено —
 * статичный значок. Пока ответ системы неизвестен (`null`, первый кадр) — значок скрыт без анимации: без кадра
 * «виден → исчез → появился».
 */
function BadgeEnter({ animated, children }: { animated: boolean; children: ReactNode }) {
  const system = useReducedMotion();
  const reduced = system ?? knownReduced;
  useEffect(() => {
    if (system !== null) knownReduced = system;
  }, [system]);
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
  if (animated && reduced === null) {
    return (
      <View testID="achievement-badge-pending" style={styles.hidden}>
        {children}
      </View>
    );
  }
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
 * Общий макет вспышки и экрана достижения (A5, A6): крупный значок, название, метка уровня счётного (L6, текстом),
 * условие текущего уровня, объект (гонка, маршрут или райд), дата факта; действия — снизу (`children`). Дата — день по
 * Минску с годом (RC-7, SSR = первый рендер).
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
  const level = itemLevelLabel(item);
  return (
    <View testID="achievement-card" style={styles.card}>
      <BadgeEnter animated={animated}>
        <AchievementBadge code={item.code} level={item.level} size={layout.badgeHero} />
      </BadgeEnter>
      <View style={styles.text}>
        <Text
          accessibilityRole="header"
          style={[textStyle('displaySm'), styles.center, { color: theme.text.primary }]}
        >
          {achievementTitle(item.code)}
        </Text>
        {level === null ? null : (
          <Text style={[textStyle('label'), styles.center, { color: theme.text.secondary }]}>
            {level}
          </Text>
        )}
        <Text style={[textStyle('body'), styles.center, { color: theme.text.secondary }]}>
          {achievementCondition(item.code, item.level)}
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

/** Круглое место значка для скелетонов (сетка блока, карточка): `Skeleton` базы в круглой рамке. */
export function BadgeSkeleton({ size }: { size: number }) {
  return (
    <View style={[styles.round, { width: size, height: size }]}>
      <Skeleton width={size} height={size} />
    </View>
  );
}

/**
 * Скелетон карточки достижения (вспышка и экран достижения, §4.12): круг значка и центрированные строки названия,
 * условия, объекта и даты — та же раскладка, что у `AchievementCard`.
 */
export function AchievementCardSkeleton() {
  return (
    <SkeletonGroup>
      <View testID="achievement-card-skeleton" style={styles.card}>
        <BadgeSkeleton size={layout.badgeHero} />
        <View style={styles.skeletonText}>
          <SkeletonText variant="displaySm" lines={1} />
          <SkeletonText variant="body" lines={2} lastLineWidth="70%" />
          <SkeletonText variant="meta" lines={1} lastLineWidth="40%" />
        </View>
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: space.s5 },
  text: { alignItems: 'center', gap: space.s2 },
  center: { textAlign: 'center' },
  hidden: { opacity: 0 },
  round: { borderRadius: radius.pill, overflow: 'hidden' },
  skeletonText: { alignSelf: 'stretch', paddingHorizontal: space.s6, gap: space.s2 },
  actions: { alignSelf: 'stretch', gap: space.s3 },
});
