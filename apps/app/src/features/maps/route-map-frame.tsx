import type { AppTheme } from '@pokatim/design-tokens';
import { textStyle } from '@rkarakulov/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MAP_ASPECT_RATIO } from './corridor-style';

/**
 * Рамка карты для обеих платформ: место фиксированной пропорции на фоне `map.background`, доступное изображение с
 * подписью-альтернативой (жесты карты — не единственный носитель информации). Ошибка стиля или тайлов — сообщение
 * поверх карты (линия остаётся, если стиль успел загрузиться).
 */
export function RouteMapFrame({
  theme,
  accessibilityLabel,
  failedMessage,
  children,
}: {
  theme: AppTheme;
  accessibilityLabel: string;
  /** текст ошибки загрузки карты; `null` — ошибки нет */
  failedMessage: string | null;
  children: ReactNode;
}) {
  return (
    <View
      testID="route-map"
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.frame, { backgroundColor: theme.map.background }]}
    >
      {children}
      {failedMessage ? (
        <View style={styles.failed}>
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{failedMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: MAP_ASPECT_RATIO, overflow: 'hidden' },
  failed: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
