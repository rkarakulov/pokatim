import { KeyboardAvoidingView, type ViewProps } from 'react-native';

/**
 * Область, которая уступает место клавиатуре (routes-07: шторка поверх карты с полем ввода). Android и web — без
 * поведения, как `auth-screen` (окно Android и визуальный viewport браузера учитывают клавиатуру сами); iOS —
 * `keyboard-avoiding-area.ios.tsx`.
 */
export function KeyboardAvoidingArea(props: ViewProps) {
  return <KeyboardAvoidingView {...props} />;
}
