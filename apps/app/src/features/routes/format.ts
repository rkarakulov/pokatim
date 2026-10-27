import type {
  CatalogRouteCard,
  CatalogRouteDetail,
  CatalogRouteElevation,
} from '@pokatim/contracts';
import { i18n, t } from '@pokatim/i18n';
import { profileTickValues, routeDurationMin, routePaceKmh } from '@pokatim/route-view';

import type { StatItem } from '@/components/stat-block';
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

// --- routes-03: карточка маршрута — стат-блок, время в пути, чипы, профиль высоты ---

/** «2 ч 30 мин», «45 мин», «3 ч». */
/** Части длительности для плиток: число и единица («2» «ч», «30» «мин»), как км/м. */
function durationParts(minutes: number): { value: string; unit: string }[] {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [
    hours > 0 ? { value: String(hours), unit: t('routes.detail.stats.hoursUnit') } : null,
    rest > 0 || hours === 0
      ? { value: String(rest), unit: t('routes.detail.stats.minutesUnit') }
      : null,
  ].filter((part) => part !== null);
}

export function routeDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [
    hours > 0 ? t('routes.detail.stats.hours', { hours }) : null,
    rest > 0 || hours === 0 ? t('routes.detail.stats.minutes', { minutes: rest }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

/** Чип формы маршрута: «Круговой» / «В одну сторону» (без стрелок: скринридер их зачитывает). */
export const routeShape = (isLoop: boolean) =>
  isLoop ? t('routes.detail.chip.loop') : t('routes.detail.chip.oneWay');

/** Чипы карточки: покрытия, форма, город; `'unknown'` — без чипа. */
export function routeChips(
  route: Pick<CatalogRouteCard, 'surfaces' | 'isLoop' | 'city'>,
): string[] {
  const surfaces = route.surfaces
    .map((surface) => domainLabel('domain.surface', surface))
    .filter((label): label is string => Boolean(label));
  const city = routeCity(route);
  return [...surfaces, routeShape(route.isLoop), ...(city ? [city] : [])];
}

/**
 * Стат-блок карточки (P2): «Дистанция · 68 км · круговой», «Набор · 620 м · макс. 267 м» (нет набора — колонки
 * нет; нет профиля — без «макс.»), «В пути · 2 ч 30 мин · при 27 км/ч».
 */
export function routeStatItems(
  route: Pick<
    CatalogRouteDetail,
    'distanceM' | 'elevationGainM' | 'isLoop' | 'surfaces' | 'elevation'
  >,
): StatItem[] {
  const pace = routePaceKmh(route.surfaces);
  const duration = routeDurationMin(route.distanceM, pace);
  const items: StatItem[] = [
    {
      value: i18n.formatNumber(km(route.distanceM), { maximumFractionDigits: 1 }),
      unit: t('routes.detail.stats.km'),
      label: t('routes.detail.stats.distance'),
      note: route.isLoop ? t('routes.detail.stats.loop') : t('routes.detail.stats.oneWay'),
    },
  ];
  if (route.elevationGainM !== null) {
    items.push({
      value: t('routes.detail.stats.gainValue', {
        gain: i18n.formatNumber(route.elevationGainM),
      }),
      unit: t('routes.detail.stats.m'),
      label: t('routes.detail.stats.gain'),
      ...(route.elevation
        ? {
            note: t('routes.detail.stats.max', { max: i18n.formatNumber(route.elevation.maxM) }),
          }
        : {}),
    });
  }
  items.push({
    value: routeDuration(duration),
    parts: durationParts(duration),
    label: t('routes.detail.stats.time'),
    note: t('routes.detail.stats.pace', { pace }),
  });
  return items;
}

/** Подпись оси X профиля: км от старта, доля длины оси (0…1) и текст («0», «20», «60 км» — единица у последней). */
export interface ProfileTick {
  km: number;
  position: number;
  label: string;
}

/** Подписи оси X профиля (RC-15): тики — `profileTickValues` (`@pokatim/route-view`), единица «км» — у последней. */
export function profileTicks(distanceM: number): ProfileTick[] {
  const ticks = profileTickValues(distanceM);
  return ticks.map((tick, index) => {
    const number = i18n.formatNumber(tick.km, { maximumFractionDigits: 2 });
    return {
      ...tick,
      label: index === ticks.length - 1 ? t('routes.detail.profile.tick', { km: number }) : number,
    };
  });
}

/** Профиль → `n` столбиков (среднее по корзине точек; точек меньше — как есть). Шаг профиля равный — корзины равны. */
export function profileBars(profile: readonly (readonly [number, number])[], n: number): number[] {
  if (profile.length <= n) return profile.map(([, elevation]) => elevation);
  return Array.from({ length: n }, (_, bar) => {
    const from = Math.floor((bar * profile.length) / n);
    const to = Math.floor(((bar + 1) * profile.length) / n);
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += profile[i]![1];
    return sum / (to - from);
  });
}

/**
 * Высоты графика (доля 0…1, пол — `PROFILE_FLOOR`) и точки линии профиля — общий пакет (routes-04 §14: панель
 * переиспользует ту же логику профиля).
 */
export { profileHeights as profileBarHeights, profilePoints } from '@pokatim/tracks';

/** Диапазон высот «191–267 м». */
export const profileRangeLabel = (elevation: Pick<CatalogRouteElevation, 'minM' | 'maxM'>) =>
  t('routes.detail.profile.range', {
    min: i18n.formatNumber(elevation.minM),
    max: i18n.formatNumber(elevation.maxM),
  });

/** Текстовая альтернатива графика (P4): «Профиль высоты: от 191 до 267 м, набор 620 м». */
export function profileSummary(
  elevation: Pick<CatalogRouteElevation, 'minM' | 'maxM'>,
  gainM: number | null,
): string {
  const range = { min: i18n.formatNumber(elevation.minM), max: i18n.formatNumber(elevation.maxM) };
  return gainM === null
    ? t('routes.detail.profile.summaryNoGain', range)
    : t('routes.detail.profile.summary', { ...range, gain: i18n.formatNumber(gainM) });
}
