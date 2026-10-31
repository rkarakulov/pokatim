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
 * `rides` — с блоком 05 (лента под `AuthGuard`: зависит от зрителя); `routes` — с каталогом маршрутов (routes-01,
 * `GET /v1/routes?limit=1`, публичный).
 */
export const AVAILABLE_HOME_SECTIONS = [
  'races',
  'rides',
  'routes',
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

/**
 * Слот секции «Свои» на Главной (K7, RC-P3-7; сейчас — подсказка имени K3, P7 — секция): «Кофе-райды» в опросе —
 * первым (индекс 0), иначе — после разделов, выбранных в опросе, и до остальных. `reasons === undefined` (профиль не
 * пришёл) — слота нет (`null`).
 */
export function socialSlotIndex(
  sections: readonly OrderedHomeSection[],
  reasons: readonly RideReason[] | undefined,
): number | null {
  if (reasons === undefined) return null;
  if (reasons.includes('group_rides')) return 0;
  return sections.filter((section) => section.chosen).length;
}
