import type { OgCardInput } from '../src/modules/sharing/og-card.inputs';

/** Факты OG-картинок для unit-тестов и превью (синтетические, публичные поля). */
export const OG_FIXTURES = {
  race: {
    kind: 'race',
    themeId: 'classic',
    scheme: 'dark',
    facts: {
      raceId: '01890a5d-ac96-774b-bcce-b302099a8001',
      title: 'Минское кольцо',
      windowStartsAt: new Date('2026-10-23T21:00:00Z'),
      windowEndsAt: new Date('2026-10-26T20:59:00Z'),
      distanceKm: 42.5,
      bikeClass: 'road',
      routeId: '01890a5d-ac96-774b-bcce-b302099a8002',
    },
  },
  ride: {
    kind: 'ride',
    themeId: 'classic',
    scheme: 'light',
    facts: {
      rideId: '01890a5d-ac96-774b-bcce-b302099a8003',
      title: 'Кофе-райд на Минское море',
      startsAt: new Date('2026-10-04T07:00:00Z'),
      place: 'у Дворца спорта, пр. Победителей',
      distanceKm: 42,
      paceMinKmh: 22,
      paceMaxKmh: 24,
      routeId: null,
    },
  },
  route: {
    kind: 'route',
    themeId: 'classic',
    scheme: 'light',
    facts: {
      routeId: '01890a5d-ac96-774b-bcce-b302099a8004',
      title: 'Кольцо через Крыжовку',
      distanceM: 64_300,
      elevationGainM: 412,
      isLoop: true,
      city: 'minsk',
    },
  },
  calendar: {
    kind: 'calendar',
    themeId: 'classic',
    scheme: 'light',
    facts: {
      startId: '01890a5d-ac96-774b-bcce-b302099a8005',
      title: 'Гран-фондо Минск',
      startsOn: '2026-11-14',
      endsOn: '2026-11-15',
      city: 'Минск',
      distancesKm: [60, 120],
    },
  },
  season: {
    kind: 'season',
    themeId: 'classic',
    scheme: 'dark',
    facts: {
      seasonId: '01890a5d-ac96-774b-bcce-b302099a8006',
      title: 'Кубок Минска 2026',
      startsOn: '2026-04-01',
      endsOn: '2026-10-31',
      raceCount: 12,
    },
  },
  rider: {
    kind: 'rider',
    themeId: 'classic',
    scheme: 'dark',
    facts: {
      publicId: 'Ab3dEf6hIj9lMn2pQr5tUv8xYz1bCd4fGh7jKl0nOpQ',
      races: 7,
      podiums: 2,
      bestPlace: 1,
    },
  },
  brand: { kind: 'brand', themeId: 'classic', scheme: 'light' },
} as const satisfies Record<OgCardInput['kind'], OgCardInput>;

type ObjectInput = Exclude<OgCardInput, { kind: 'brand' }>;
type InputOf<K extends ObjectInput['kind']> = Extract<ObjectInput, { kind: K }>;

/** Копия фикстуры вида с заменой полей фактов. */
export function ogFixture<K extends ObjectInput['kind']>(
  kind: K,
  facts: Partial<InputOf<K>['facts']> = {},
): InputOf<K> {
  const base = OG_FIXTURES[kind] as ObjectInput;
  return { ...base, facts: { ...base.facts, ...facts } } as unknown as InputOf<K>;
}
