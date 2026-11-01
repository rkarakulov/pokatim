import { View, type ViewProps } from 'react-native';

/** Web: клавиатуру учитывает браузер (визуальный viewport) — обычная область. */
export function KeyboardAvoidingArea(props: ViewProps) {
  return <View {...props} />;
}
