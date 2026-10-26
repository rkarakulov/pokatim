import { AccessibilityInfo, type HostInstance } from 'react-native';

/**
 * Перевести фокус скринридера на элемент (заголовок появившейся панели): native — VoiceOver / TalkBack
 * (`sendAccessibilityEvent(…, 'focus')`). Web — `accessibility-focus.web.ts`.
 */
export function focusForAccessibility(target: HostInstance | null): void {
  if (target) AccessibilityInfo.sendAccessibilityEvent(target, 'focus');
}
