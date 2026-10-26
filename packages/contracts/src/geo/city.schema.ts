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

/** Код города в запросе — строгий. */
export const CityCode = z.enum(CITY_CODES, { error: fieldError('REQUIRED') });
export type CityCode = z.infer<typeof CityCode>;

export const isCityCode = (code: string): code is CityCode =>
  (CITY_CODES as readonly string[]).includes(code);
