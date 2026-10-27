import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

/**
 * Корень жестов (routes-04, RC-3): native — `GestureHandlerRootView` (без него `GestureDetector` v3 не распознаёт
 * жесты и в dev бросает). Web — `gesture-root.web.tsx` (обычный `View`): RNGH не попадает в web-бандл и SSR.
 */
export function GestureRoot({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return <GestureHandlerRootView style={style}>{children}</GestureHandlerRootView>;
}
