import { Platform } from 'react-native';

/** Какие внешние карты открывать (`maps-link.ts`); web — `maps-platform.web.ts` по браузеру. */
export type MapsPlatform = 'ios' | 'android' | 'other';

export const mapsPlatform = (): MapsPlatform =>
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';
