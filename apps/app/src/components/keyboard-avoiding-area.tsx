import { KeyboardAvoidingView, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Область, которая уступает место клавиатуре (routes-07: шторка поверх карты с полем ввода), — iOS и Android.
 * `padding`: отступ снизу на высоту перекрытия клавиатурой. Android — тоже `padding`: приложение edge-to-edge (Expo 58,
 * RN 0.88), окно под клавиатуру не ужимается (`adjustResize` в edge-to-edge не действует), высоту даёт событие
 * `keyboardDidShow` (`KeyboardAvoidingView` слушает его на Android). Нижний safe-area inset держат сами дети (шторка —
 * `SafeAreaView` снизу), поэтому отступ меньше на `insets.bottom` — без зазора над клавиатурой. Web —
 * `keyboard-avoiding-area.web.tsx`.
 */
export function KeyboardAvoidingArea(props: ViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={-insets.bottom} {...props} />
  );
}
