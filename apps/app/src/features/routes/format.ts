import type { CatalogRouteCard } from '@pokatim/contracts';
import { i18n, t } from '@pokatim/i18n';

import type { HeroDate } from '@/lib/minsk-format';
import { domainLabel, formatDistances, meta } from '@/lib/minsk-format';

/** Подписи маршрута каталога (вкладка, карточка, Главная, мета) — чистые функции; `'unknown'` — без своей части. */

const km = (distanceM: number) => Math.round(distanceM / 100) / 10;

/** «86 км», «48,6 км» — длина маршрута с десятыми. */
export const routeKm = (distanceM: number) => formatDistances([km(distanceM)]) ?? '';

const elevation = (route: Pick<CatalogRouteCard, 'elevationGainM'>) =>
  route.elevationGainM === null
    ? null
    : t('routes.stats.elevation', { gain: i18n.formatNumber(route.elevationGainM) });

/** «86 км · набор 1 240 м · петля»; набора нет — без него, не петля — без «петля». */
export function routeStats(
  route: Pick<CatalogRouteCard, 'distanceM' | 'elevationGainM' | 'isLoop'>,
): string {
  return meta([
    routeKm(route.distanceM),
    elevation(route),
    route.isLoop ? t('routes.stats.loop') : null,
  ]);
}

/** Покрытия строчными через запятую: «асфальт, гравий». */
export function routeSurfaces(route: Pick<CatalogRouteCard, 'surfaces'>): string {
  return route.surfaces
    .map((surface) => domainLabel('domain.surface', surface)?.toLocaleLowerCase('ru'))
    .filter((label): label is string => Boolean(label))
    .join(', ');
}

/** Город старта по справочнику; `'unknown'` — `null`. */
export const routeCity = (route: Pick<CatalogRouteCard, 'city'>) =>
  domainLabel('domain.city', route.city);

/** «Минск · асфальт, гравий». */
export function routePlace(route: Pick<CatalogRouteCard, 'city' | 'surfaces'>): string {
  return meta([routeCity(route), routeSurfaces(route) || null]);
}

/** Описание для мета и OG (без ПДн): «86 км · набор 1 240 м · петля · Минск». */
export function routeShareDescription(route: CatalogRouteCard): string {
  return meta([routeStats(route), routeCity(route)]);
}

/** Крупная цифра героя (Главная, RC-8): длина «86» + «км». */
export function routeHeroDate(route: Pick<CatalogRouteCard, 'distanceM'>): HeroDate {
  return {
    value: i18n.formatNumber(km(route.distanceM), { maximumFractionDigits: 1 }),
    unit: t('routes.heroUnit'),
  };
}
