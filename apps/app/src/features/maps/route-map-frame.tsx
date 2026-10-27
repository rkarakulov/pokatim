import type { AppTheme } from '@pokatim/design-tokens';
import { textStyle } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MAP_ASPECT_RATIO } from './corridor-style';

/**
 * Рамка карты для обеих платформ: место фиксированной пропорции на фоне `map.background` (routes-04d: `fill` — вся
 * область, `flex: 1`; сообщение об ошибке — над шторкой, отступ `bottomInset`). Подпись-альтернатива
 * (жесты карты — не единственный носитель информации) — отдельный доступный слой-изображение под картой без касаний,
 * а не обёртка: иначе `accessible`-обёртка спрятала бы от скринридера кнопку атрибуции карты. Ошибка стиля или
 * тайлов — сообщение поверх карты без повтора (линия остаётся, если стиль успел загрузиться; §8.2 D7).
 */
export function RouteMapFrame({
  theme,
  accessibilityLabel,
  failedMessage,
  fill = false,
  bottomInset = 0,
  children,
}: {
  theme: AppTheme;
  accessibilityLabel: string;
  /** текст ошибки загрузки карты; `null` — ошибки нет */
  failedMessage: string | null;
  fill?: boolean;
  bottomInset?: number;
  children: ReactNode;
}) {
  return (
    <View
      testID="route-map"
      style={[fill ? styles.fill : styles.frame, { backgroundColor: theme.map.background }]}
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        style={styles.label}
      />
      {children}
      {failedMessage ? (
        <View style={[styles.failed, { paddingBottom: bottomInset }]}>
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{failedMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: MAP_ASPECT_RATIO, overflow: 'hidden' },
  fill: { flex: 1, width: '100%', overflow: 'hidden' },
  label: { ...StyleSheet.absoluteFill, pointerEvents: 'none' },
  failed: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});
