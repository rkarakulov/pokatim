import { z } from 'zod';

import { fieldError } from '../common.ts';

/**
 * Справочник городов Беларуси (кофе-райды, Q3): коды латиницей, подписи — `domain.city.<код>` в `@pokatim/i18n`.
 * Свободного текста нет — чипы фильтра видят все райдеры (UGC). Только в конец: ответы приложения разбирают
 * `tolerantEnum` (или отбрасывают незнакомые коды).
 */
export const CITY_CODES = [
  'minsk',
  'brest',
  'vitebsk',
  'gomel',
  'grodno',
  'mogilev',
  'baranovichi',
  'bobruisk',
  'borisov',
  'pinsk',
  'orsha',
  'mozyr',
  'soligorsk',
  'novopolotsk',
  'lida',
  'molodechno',
  'polotsk',
  'zhlobin',
  'svetlogorsk',
  'rechitsa',
  'slutsk',
  'zhodino',
  'kobrin',
  'slonim',
  'volkovysk',
] as const;

/**
 * Центры городов (05c, WGS84 `[lon, lat]`, 4 знака — ратуша или центральная площадь): точка «Рядом» райда без
 * маршрута (API) и камера пустой карты ленты (приложение). `Record<CityCode, …>` не даст пропустить город.
 */
export const CITY_CENTERS: Readonly<Record<CityCode, readonly [number, number]>> = {
  minsk: [27.559, 53.9006],
  brest: [23.7341, 52.0976],
  vitebsk: [30.2049, 55.1904],
  gomel: [30.9754, 52.4345],
  grodno: [23.8131, 53.6694],
  mogilev: [30.3449, 53.9168],
  baranovichi: [26.0139, 53.1327],
  bobruisk: [29.2214, 53.1384],
  borisov: [28.505, 54.2279],
  pinsk: [26.0951, 52.1229],
  orsha: [30.4172, 54.5081],
  mozyr: [29.2456, 52.0495],
  soligorsk: [27.5415, 52.7876],
  novopolotsk: [28.6534, 55.5346],
  lida: [25.2997, 53.8833],
  molodechno: [26.85, 54.3167],
  polotsk: [28.7856, 55.4879],
  zhlobin: [30.024, 52.8926],
  svetlogorsk: [29.7389, 52.6329],
  rechitsa: [30.3916, 52.3617],
  slutsk: [27.5597, 53.0274],
  zhodino: [28.3331, 54.0985],
  kobrin: [24.3564, 52.2138],
  slonim: [25.3163, 53.0869],
  volkovysk: [24.4513, 53.1561],
};

/** Код города в запросе — строгий. */
export const CityCode = z.enum(CITY_CODES, { error: fieldError('REQUIRED') });
export type CityCode = z.infer<typeof CityCode>;

export const isCityCode = (code: string): code is CityCode =>
  (CITY_CODES as readonly string[]).includes(code);
