import type { HostInstance } from 'react-native';

/**
 * Web: фокус на DOM-элемент (react-native-web отдаёт его в ref). Заголовок сам по себе не фокусируемый — `tabindex=-1`
 * делает его целью программного фокуса, не добавляя в порядок Tab; скринридер читает его как текущий.
 */
export function focusForAccessibility(target: HostInstance | null): void {
  const element = target as unknown as HTMLElement | null;
  if (!element || typeof element.focus !== 'function') return;
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  element.focus();
}
