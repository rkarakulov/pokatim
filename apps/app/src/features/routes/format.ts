import type {
  CatalogRouteCard,
  CatalogRouteDetail,
  CatalogRouteElevation,
} from '@pokatim/contracts';
import { i18n, t } from '@pokatim/i18n';

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

/**
 * Средняя скорость по покрытию для оценки времени в пути, км/ч (`[ASSUMPTION]` P3 routes-03): асфальт 27, гравий 20,
 * асфальт + гравий 24; покрытие неизвестно — как асфальт. Набор высоты не учитывается (v1).
 */
export const ROUTE_PACE_KMH = { asphalt: 27, gravel: 20, mixed: 24 } as const;

/** Шаг округления времени в пути, мин (и минимум). */
const DURATION_STEP_MIN = 5;

/** Скорость по известным покрытиям маршрута; ни одного известного — асфальт. */
export function routePaceKmh(surfaces: CatalogRouteCard['surfaces']): number {
  const asphalt = surfaces.includes('asphalt');
  const gravel = surfaces.includes('gravel');
  if (asphalt && gravel) return ROUTE_PACE_KMH.mixed;
  if (gravel) return ROUTE_PACE_KMH.gravel;
  return ROUTE_PACE_KMH.asphalt;
}

/** Время в пути, мин: дистанция ÷ скорость, до 5 мин, не меньше 5 мин. */
export function routeDurationMin(distanceM: number, paceKmh: number): number {
  const minutes = (distanceM / 1000 / paceKmh) * 60;
  return Math.max(DURATION_STEP_MIN, Math.round(minutes / DURATION_STEP_MIN) * DURATION_STEP_MIN);
}

/** «2 ч 30 мин», «45 мин», «3 ч». */
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
    value: routeDuration(routeDurationMin(route.distanceM, pace)),
    label: t('routes.detail.stats.time'),
    note: t('routes.detail.stats.pace', { pace }),
  });
  return items;
}

/** Шаги подписей оси X профиля, км: 1/2/5 × 10ⁿ. */
const TICK_MULTIPLIERS = [1, 2, 5] as const;
/** Подписей оси X не больше (с «0»). */
const PROFILE_TICKS_MAX = 5;

/** Подпись оси X профиля: км от старта, доля длины оси (0…1) и текст («0», «20», «60 км» — единица у последней). */
export interface ProfileTick {
  km: number;
  position: number;
  label: string;
}

/**
 * Подписи оси X профиля (RC-15): шаг — наименьший из 1/2/5 × 10ⁿ км, при котором подписей (с «0») ≤ 5; единица «км»
 * — у последней. 68 км → 0, 20, 40, 60 км.
 */
export function profileTicks(distanceM: number): ProfileTick[] {
  const totalKm = distanceM / 1000;
  if (totalKm <= 0) return [];
  let step = 0;
  for (let exponent = -2; step === 0 && exponent <= 4; exponent += 1) {
    for (const multiplier of TICK_MULTIPLIERS) {
      const candidate = multiplier * 10 ** exponent;
      if (Math.floor(totalKm / candidate + 1e-9) + 1 <= PROFILE_TICKS_MAX) {
        step = candidate;
        break;
      }
    }
  }
  const count = Math.floor(totalKm / step + 1e-9) + 1;
  return Array.from({ length: count }, (_, index) => {
    const value = Math.round(index * step * 1000) / 1000;
    const number = i18n.formatNumber(value, { maximumFractionDigits: 2 });
    return {
      km: value,
      position: Math.min(1, (value * 1000) / distanceM),
      label: index === count - 1 ? t('routes.detail.profile.tick', { km: number }) : number,
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

/** Нижняя граница высоты столбика, доля: самая низкая точка профиля не пропадает. */
const PROFILE_BAR_FLOOR = 0.08;

/** Высоты столбиков, доля 0…1 высоты графика: мин. профиля — 8 %, макс. — 100 %; ровный профиль — середина. */
export function profileBarHeights(bars: readonly number[], minM: number, maxM: number): number[] {
  if (maxM <= minM) return bars.map(() => 0.5);
  return bars.map(
    (value) => PROFILE_BAR_FLOOR + ((1 - PROFILE_BAR_FLOOR) * (value - minM)) / (maxM - minM),
  );
}

/**
 * Точки линии профиля для SVG (web): `[x, y]` в долях 0…1 — X по дистанции (последняя точка — 1), Y — высота от низа
 * по тем же правилам, что столбики (`profileBarHeights`). Меньше двух точек — `[]`.
 */
export function profilePoints(
  profile: readonly (readonly [number, number])[],
  minM: number,
  maxM: number,
): [number, number][] {
  const total = profile.at(-1)?.[0] ?? 0;
  if (profile.length < 2 || total <= 0) return [];
  const heights = profileBarHeights(
    profile.map(([, elevation]) => elevation),
    minM,
    maxM,
  );
  return profile.map(([distance], index) => [distance / total, heights[index]!]);
}

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
