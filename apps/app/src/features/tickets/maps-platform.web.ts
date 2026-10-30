import { isIosDevice } from '@/features/pwa-install/install-platform';

import type { MapsPlatform } from './maps-platform';

export type { MapsPlatform } from './maps-platform';

/**
 * Web (PWA и браузер): платформа устройства по `navigator` — iPhone/iPad (и iPadOS-«Mac» с сенсором) — Apple Maps,
 * Android — `geo:`, десктоп — Яндекс. Только в обработчике нажатия (SSR без `navigator`).
 */
export function mapsPlatform(): MapsPlatform {
  if (typeof navigator === 'undefined') return 'other';
  if (isIosDevice(navigator)) return 'ios';
  return /Android/i.test(navigator.userAgent) ? 'android' : 'other';
}
