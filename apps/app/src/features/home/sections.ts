import type { RideReason } from '@pokatim/contracts';

export type HomeSectionId = 'races' | 'rides' | 'routes' | 'calendar';

/** Базовый порядок разделов Главной — порядок вкладок. */
export const HOME_SECTION_ORDER: readonly HomeSectionId[] = [
  'races',
  'rides',
  'routes',
  'calendar',
];

/**
 * Разделы с живым read-API (Q1, Q2): раздел входит в реестр только вместе со своим бэкендом, без заглушек «скоро».
 * `rides` — с блоком 05 (лента под `AuthGuard`: зависит от зрителя); `routes` — со своим блоком.
 */
export const AVAILABLE_HOME_SECTIONS = [
  'races',
  'rides',
  'calendar',
] as const satisfies readonly HomeSectionId[];
export type AvailableHomeSectionId = (typeof AVAILABLE_HOME_SECTIONS)[number];

/** Ответ опроса «Что вас привело?» → раздел Главной; `exploring` раздела не поднимает. */
const SECTION_BY_REASON: Partial<Record<RideReason, HomeSectionId>> = {
  races: 'races',
  group_rides: 'rides',
  routes: 'routes',
  calendar: 'calendar',
};

export interface OrderedHomeSection<Id extends HomeSectionId = HomeSectionId> {
  id: Id;
  /** Раздел отмечен в опросе: стоит первым, в шапке — тег «по вашему выбору». */
  chosen: boolean;
}

/**
 * Порядок разделов Главной (R4, Q4): отмеченные в опросе разделы — первыми с тегом, между собой и среди остальных —
 * в порядке вкладок. `reasons === undefined` (профиль ещё не пришёл или не загрузился) — базовый порядок без тегов.
 */
export function orderHomeSections<Id extends HomeSectionId>(
  available: readonly Id[],
  reasons: readonly RideReason[] | undefined,
): OrderedHomeSection<Id>[] {
  const chosen = new Set((reasons ?? []).map((reason) => SECTION_BY_REASON[reason]));
  const isAvailable = (id: HomeSectionId): id is Id =>
    (available as readonly string[]).includes(id);
  const sections = HOME_SECTION_ORDER.filter(isAvailable).map((id) => ({
    id,
    chosen: chosen.has(id),
  }));
  return [...sections.filter((s) => s.chosen), ...sections.filter((s) => !s.chosen)];
}
