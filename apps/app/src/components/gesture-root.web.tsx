import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** Корень жестов на web (routes-04, RC-3): жесты профиля и маркера — pointer events DOM, RNGH не нужен. */
export function GestureRoot({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return <View style={style}>{children}</View>;
}
