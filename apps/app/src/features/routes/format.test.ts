/// <reference types="jest" />
import type { CatalogRouteCard, CatalogRouteDetail } from '@pokatim/contracts';
import { ROUTE_PACE_KMH, routeDurationMin, routePaceKmh } from '@pokatim/route-view';

import {
  profileBarHeights,
  profilePoints,
  profileBars,
  profileRangeLabel,
  profileSummary,
  profileTicks,
  routeAuthorLabel,
  routeChips,
  routeDuration,
  routeHeroDate,
  routeKm,
  routePlace,
  routeShareDescription,
  routeStatItems,
  routeStats,
} from './format';

const route = (overrides: Partial<CatalogRouteCard> = {}): CatalogRouteCard => ({
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 1_240,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt', 'gravel'],
  publishedAt: '2026-10-20T10:00:00.000Z',
  author: { kind: 'team' },
  ...overrides,
});
const text = (value: string | null) => value?.replace(/\u00a0/g, ' ');

describe('подписи маршрута каталога (routes-01)', () => {
  it('км — с десятыми, без лишнего нуля', () => {
    expect(routeKm(86_012)).toBe('86 км');
    expect(text(routeKm(48_550))).toBe('48,6 км');
    expect(routeHeroDate(route({ distanceM: 48_550 }))).toEqual({ value: '48,6', unit: 'км' });
  });

  it('статистика: км · набор · петля; набор null и не петля — без своих частей', () => {
    expect(text(routeStats(route()))).toBe('86 км · набор 1 240 м · петля');
    expect(routeStats(route({ elevationGainM: null, isLoop: false }))).toBe('86 км');
  });

  it('место: город · покрытия строчными; unknown — без своей части', () => {
    expect(routePlace(route())).toBe('Минск · асфальт, гравий');
    expect(routePlace(route({ city: 'unknown', surfaces: ['unknown', 'gravel'] }))).toBe('гравий');
    expect(routePlace(route({ city: 'unknown', surfaces: ['unknown'] }))).toBe('');
  });

  it('описание для мета/OG: только цифры и город, без ПДн', () => {
    expect(text(routeShareDescription(route()))).toBe('86 км · набор 1 240 м · петля · Минск');
  });

  it('routes-06: автор — команда без бейджа; райдер — «От райдера» и имя, только если сервер его дал', () => {
    expect(routeAuthorLabel(route())).toBeNull();
    expect(routeAuthorLabel(route({ author: { kind: 'rider', name: null } }))).toBe('От райдера');
    expect(routeAuthorLabel(route({ author: { kind: 'rider', name: 'Аня К.' } }))).toBe(
      'От райдера · Аня К.',
    );
    // OG и мета — без имени автора (U9)
    expect(text(routeShareDescription(route({ author: { kind: 'rider', name: 'Аня К.' } })))).toBe(
      '86 км · набор 1 240 м · петля · Минск',
    );
  });
});

const detail = (overrides: Partial<CatalogRouteDetail> = {}): CatalogRouteDetail => ({
  ...route({ distanceM: 68_000, elevationGainM: 620, surfaces: ['asphalt'] }),
  elevation: {
    minM: 191,
    maxM: 267,
    profile: [
      [0, 191],
      [68_000, 267],
    ],
  },
  gpxAvailable: true,
  ...overrides,
});

describe('время в пути (routes-03, P3)', () => {
  it('скорость по покрытию: асфальт 27, гравий 20, оба 24, пусто/unknown — 27', () => {
    expect(ROUTE_PACE_KMH).toEqual({ asphalt: 27, gravel: 20, mixed: 24 });
    expect(routePaceKmh(['asphalt'])).toBe(27);
    expect(routePaceKmh(['gravel'])).toBe(20);
    expect(routePaceKmh(['gravel', 'asphalt'])).toBe(24);
    expect(routePaceKmh([])).toBe(27);
    expect(routePaceKmh(['unknown'])).toBe(27);
    expect(routePaceKmh(['unknown', 'gravel'])).toBe(20);
  });

  it('68 км при 27 км/ч — 2 ч 30 мин; до 5 мин; минимум 5 мин', () => {
    expect(routeDuration(routeDurationMin(68_000, 27))).toBe('2 ч 30 мин');
    // 1 км при 27 км/ч — 2,2 мин → минимум 5
    expect(routeDurationMin(1_000, 27)).toBe(5);
    // 20 км при 27 км/ч — 44,4 мин → 45
    expect(routeDurationMin(20_000, 27)).toBe(45);
    expect(routeDuration(45)).toBe('45 мин');
    expect(routeDuration(180)).toBe('3 ч');
    expect(routeDuration(5)).toBe('5 мин');
  });
});

describe('карточка: чипы и стат-блок (routes-03, P1, P2)', () => {
  it('чипы: покрытия, форма, город; unknown — без чипа', () => {
    expect(routeChips(route())).toEqual(['Асфальт', 'Гравий', 'Круговой', 'Минск']);
    expect(routeChips(route({ isLoop: false, city: 'unknown', surfaces: ['unknown'] }))).toEqual([
      'В одну сторону',
    ]);
  });

  it('три колонки: дистанция с формой, набор с макс., время с темпом', () => {
    expect(routeStatItems(detail())).toEqual([
      { value: '68', unit: 'км', label: 'Дистанция', note: 'круговой' },
      { value: '620', unit: 'м', label: 'Набор', note: 'макс. 267 м' },
      {
        value: '2 ч 30 мин',
        // app-themes C (ревью pass 1): по частям — плитки переносят «2 ч / 30 мин», а не обрезают
        parts: [
          { value: '2', unit: 'ч' },
          { value: '30', unit: 'мин' },
        ],
        label: 'В пути',
        note: 'при 27 км/ч',
      },
    ]);
  });

  it('длительность по частям: без часов — только минуты, ровно часы — без минут', () => {
    const time = (distanceM: number) => routeStatItems(detail({ distanceM })).at(-1)!.parts;
    expect(time(9_000)).toEqual([{ value: '20', unit: 'мин' }]);
    expect(time(54_000)).toEqual([{ value: '2', unit: 'ч' }]);
  });

  it('нет профиля — набор без «макс.»; нет набора — две колонки; в одну сторону', () => {
    const [, gain] = routeStatItems(detail({ elevation: null }));
    expect(gain).toEqual({ value: '620', unit: 'м', label: 'Набор' });
    const items = routeStatItems(detail({ elevationGainM: null, elevation: null, isLoop: false }));
    expect(items.map((item) => item.label)).toEqual(['Дистанция', 'В пути']);
    expect(items[0]!.note).toBe('в одну сторону');
  });
});

describe('профиль высоты (routes-03, P4)', () => {
  const labels = (distanceM: number) => profileTicks(distanceM).map((tick) => text(tick.label));

  it('подписи оси X: шаг 1/2/5 × 10ⁿ, ≤ 5 подписей, «км» у последней', () => {
    expect(labels(68_000)).toEqual(['0', '20', '40', '60 км']);
    expect(labels(5_000)).toEqual(['0', '2', '4 км']);
    expect(labels(1_200)).toEqual(['0', '0,5', '1 км']);
    expect(labels(250_000)).toEqual(['0', '100', '200 км']);
    const ticks = profileTicks(68_000);
    expect(ticks[0]!.position).toBe(0);
    expect(ticks.at(-1)!.position).toBeCloseTo(60 / 68, 6);
  });

  it('столбики: ≤ n, средние по корзине; точек меньше — как есть', () => {
    const profile = Array.from({ length: 300 }, (_, i) => [i * 100, i] as [number, number]);
    const bars = profileBars(profile, 96);
    expect(bars).toHaveLength(96);
    expect(bars[0]).toBeCloseTo(1, 6); // точки 0..3 → среднее 1
    expect(bars.at(-1)).toBeCloseTo(297.5, 6); // точки 296..299
    expect(
      profileBars(
        [
          [0, 5],
          [10, 7],
        ],
        96,
      ),
    ).toEqual([5, 7]);
  });

  it('высоты столбиков: мин. — 8 %, макс. — 100 %, ровный — середина', () => {
    expect(profileBarHeights([191, 267], 191, 267)).toEqual([0.08, 1]);
    expect(profileBarHeights([200, 200], 200, 200)).toEqual([0.5, 0.5]);
    // точки SVG (web): X — доля дистанции, Y — те же доли высоты, что у столбиков
    expect(
      profilePoints(
        [
          [0, 191],
          [500, 229],
          [1000, 267],
        ],
        191,
        267,
      ),
    ).toEqual([
      [0, 0.08],
      [0.5, 0.54],
      [1, 1],
    ]);
    expect(profilePoints([[0, 200]], 200, 200)).toEqual([]);
  });

  it('диапазон и текстовая альтернатива', () => {
    const elevation = { minM: 191, maxM: 267 };
    expect(profileRangeLabel(elevation)).toBe('191–267 м');
    expect(profileSummary(elevation, 620)).toBe('Профиль высоты: от 191 до 267 м, набор 620 м');
    expect(profileSummary(elevation, null)).toBe('Профиль высоты: от 191 до 267 м');
  });
});
