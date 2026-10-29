import {
  CalendarPage,
  CatalogRoutePage,
  CurrentSeasonResponse,
  RacePage,
} from '@pokatim/contracts';

import { NEXT_CALENDAR_START, NEXT_RACE } from '@/features/home/queries';
import { fetchPublicForSsr, ssrData } from '@/lib/public-ssr';

import { LANDING_ROUTES } from './queries';

/** Посев лендинга: часть `null` — API её не отдал (нет `API_INTERNAL_URL`, сеть, таймаут, 5xx), экран догрузит сам. */
export interface LandingSeed {
  races: RacePage | null;
  season: CurrentSeasonResponse | null;
  routes: CatalogRoutePage | null;
  calendar: CalendarPage | null;
}

/** Строка запроса из тех же параметров, что у клиентских хуков (массив — повтором ключа). */
const search = (params: object) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([key, value]: [string, unknown]) =>
      (Array.isArray(value) ? value : [value]).map((item) => [key, String(item)]),
    ),
  ).toString();

export const LANDING_SSR_PATHS = {
  races: `/v1/races?${search(NEXT_RACE)}`,
  season: '/v1/seasons/current',
  routes: `/v1/routes?${search(LANDING_ROUTES)}`,
  calendar: `/v1/calendar?${search(NEXT_CALENDAR_START)}`,
} as const;

/**
 * `loader` лендинга (RC-11): четыре публичных списка параллельно через `public-ssr` (кэш процесса, таймаут);
 * частичный успех допустим, всегда объект — не бросает (`fetchPublicForSsr` сбои не пробрасывает).
 */
export async function loadLandingSeed(): Promise<LandingSeed> {
  const [races, season, routes, calendar] = await Promise.all([
    fetchPublicForSsr(LANDING_SSR_PATHS.races, RacePage),
    fetchPublicForSsr(LANDING_SSR_PATHS.season, CurrentSeasonResponse),
    fetchPublicForSsr(LANDING_SSR_PATHS.routes, CatalogRoutePage),
    fetchPublicForSsr(LANDING_SSR_PATHS.calendar, CalendarPage),
  ]);
  return {
    races: ssrData(races),
    season: ssrData(season),
    routes: ssrData(routes),
    calendar: ssrData(calendar),
  };
}
