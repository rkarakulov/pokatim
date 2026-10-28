import type { AppTheme } from '@pokatim/design-tokens';
import { useReducedMotion, useTheme } from '@rkarakulov/ui';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';

import { DecorSvg } from './decor-svg';
import { BAT, COBWEB, halloweenColors, MOON, PUMPKIN, SPIDER, WITCH } from './halloween-art';
import { HALLOWEEN_LAYOUT as L, HALLOWEEN_MOTION as M } from './halloween-layout';

/**
 * Хеллоуинский декор на native (halloween-decor): слой поверх области ленты — паутина с пауком, луна, летучие мыши,
 * ведьма на метле и тыквы. Касания не перехватывает, скрыт от скринридеров. Анимации (паук покачивается, ведьма
 * пролетает) — только при выключенном reduce motion; неизвестно или включено — статично. Web — `.web.tsx`.
 */
export function HalloweenDecor() {
  const colors = halloweenColors(useTheme<AppTheme>());
  const animate = useReducedMotion() === false;
  const { width } = useWindowDimensions();
  const [bob] = useState(() => new Animated.Value(0));
  const [fly] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!animate) return;
    const swing = (toValue: number) =>
      Animated.timing(bob, {
        toValue,
        duration: M.bobMs,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });
    const loops = [
      Animated.loop(Animated.sequence([swing(1), swing(0)])),
      Animated.loop(
        Animated.sequence([
          Animated.timing(fly, {
            toValue: 1,
            duration: M.flyMs,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.delay(M.flyPauseMs),
          Animated.timing(fly, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    ];
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
      bob.setValue(0);
      fly.setValue(0);
    };
  }, [animate, bob, fly]);

  const spiderHeight = L.spider.thread + L.spider.size;
  return (
    <View
      testID="halloween-decor"
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={styles.layer}
    >
      <View style={[styles.cobweb, { opacity: L.cobweb.opacity }]}>
        <DecorSvg art={COBWEB} colors={colors} />
      </View>
      <Animated.View
        testID="halloween-spider"
        style={[
          styles.spider,
          {
            opacity: L.spider.opacity,
            height: spiderHeight,
            transform: [
              {
                translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, L.spider.bob] }),
              },
            ],
          },
        ]}
      >
        <View style={[styles.thread, { backgroundColor: colors.ink, height: L.spider.thread }]} />
        <View style={styles.spiderBody}>
          <DecorSvg art={SPIDER} colors={colors} />
        </View>
      </Animated.View>
      <View style={[styles.moon, { opacity: L.moon.opacity }]}>
        <DecorSvg art={MOON} colors={colors} />
      </View>
      {L.bats.map((bat, index) => (
        <View
          key={index}
          style={[
            styles.abs,
            {
              top: bat.top,
              left: bat.left,
              width: bat.size,
              height: bat.size / 2,
              opacity: bat.opacity,
            },
          ]}
        >
          <DecorSvg art={BAT} colors={colors} />
        </View>
      ))}
      <Animated.View
        testID="halloween-witch"
        style={[
          styles.witch,
          animate
            ? {
                top: L.witch.flyTop,
                left: 0,
                transform: [
                  {
                    translateX: fly.interpolate({
                      inputRange: [0, 1],
                      outputRange: [width + L.witch.width, -L.witch.width * 1.5],
                    }),
                  },
                ],
              }
            : { top: L.witch.top, left: L.witch.left },
        ]}
      >
        <DecorSvg art={WITCH} colors={colors} />
      </Animated.View>
      {L.pumpkins.map((pumpkin, index) => (
        <View
          key={index}
          style={[
            styles.abs,
            {
              right: pumpkin.right,
              bottom: pumpkin.bottom,
              width: pumpkin.size,
              height: pumpkin.size * 0.9,
              opacity: pumpkin.opacity,
            },
          ]}
        >
          <DecorSvg art={PUMPKIN} colors={colors} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  abs: { position: 'absolute' },
  cobweb: { position: 'absolute', top: 0, right: 0, width: L.cobweb.size, height: L.cobweb.size },
  spider: {
    position: 'absolute',
    top: L.spider.threadTop,
    right: L.spider.right,
    width: L.spider.size,
    alignItems: 'center',
  },
  thread: { width: StyleSheet.hairlineWidth },
  spiderBody: { width: L.spider.size, height: L.spider.size },
  moon: {
    position: 'absolute',
    top: L.moon.top,
    left: L.moon.left,
    width: L.moon.size,
    height: L.moon.size,
  },
  witch: {
    position: 'absolute',
    width: L.witch.width,
    height: L.witch.height,
    opacity: L.witch.opacity,
  },
});
