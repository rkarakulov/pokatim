import { KeyboardAvoidingView, type ViewProps } from 'react-native';

/** iOS: область поднимается над клавиатурой отступом снизу (`padding`, как `auth-screen`). */
export function KeyboardAvoidingArea(props: ViewProps) {
  return <KeyboardAvoidingView behavior="padding" {...props} />;
}
