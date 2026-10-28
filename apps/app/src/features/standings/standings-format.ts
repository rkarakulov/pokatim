import type {
  BikeClass,
  MySeasonStandings,
  ResultGroupKey,
  SeasonStandingCell,
  SeasonStandingRow,
  SeasonStandingsTable,
  SeasonStandingsTableRef,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import { groupLabel } from '@/features/races/participation-format';
import { domainLabel } from '@/lib/minsk-format';

/*
 * Рейтинг сезона (race-results-08c) — чистая логика показа. Очки, места, N из M и «в зачёте» — только с сервера
 * (`standings.policy.ts`); здесь — тексты и выбор таблицы. `'unknown'` (сервер новее) — таблица не показывается:
 * запросить её строгим `bikeClass`/`group` нельзя.
 */

type Key = { bikeClass: BikeClass | 'unknown'; groupKey: ResultGroupKey | 'unknown' };

/** Место «=6» при ничьей; для скринридера — «6-е место поровну» (как таблица гонки). */
export function placeView(place: number, tied: boolean): { text: string; a11y: string } {
  return tied
    ? {
        text: t('races.results.tiePlace', { place }),
        a11y: t('races.results.tiedA11y', { place }),
      }
    : { text: String(place), a11y: String(place) };
}

export const pointsText = (points: number) => t('season.standings.points', { count: points });

export const classLabel = (bikeClass: BikeClass | 'unknown') =>
  domainLabel('domain.bikeClass', bikeClass) ?? '';

/** «Мужчины до 40 · Шоссе». */
export const tableLabel = (
  groupKey: ResultGroupKey | 'unknown',
  bikeClass: BikeClass | 'unknown',
) => t('season.standings.table', { group: groupLabel(groupKey), class: classLabel(bikeClass) });

/** Строка таблицы: своя — «Вы» (полоса и метка текстом), чужая — имя (с согласием) или «Участник». */
export function standingRow(
  row: SeasonStandingRow,
  own: boolean,
): { place: string; who: string; points: string; a11y: string } {
  const place = placeView(row.place, row.tied);
  const who = own ? t('races.results.you') : (row.riderName ?? t('races.results.rider'));
  const points = pointsText(row.points);
  return {
    place: place.text,
    who,
    points,
    a11y: t('season.standings.rowA11y', { place: place.a11y, who, points }),
  };
}

export type KnownTable = SeasonStandingsTableRef & {
  bikeClass: BikeClass;
  groupKey: ResultGroupKey;
};

const known = (ref: SeasonStandingsTableRef): ref is KnownTable =>
  ref.bikeClass !== 'unknown' && ref.groupKey !== 'unknown';

const sameTable = (a: Key, b: Key) => a.bikeClass === b.bikeClass && a.groupKey === b.groupKey;

export interface PickedTable {
  bikeClass?: BikeClass;
  groupKey?: ResultGroupKey;
}

/**
 * Таблица на экране: выбор пользователя, если он есть в сводке; иначе своя (первая из `/me`, что есть в сводке),
 * иначе первая сводки. Класс сменился — своя группа в нём или первая группа класса. `classes` / `groups` — сегменты
 * переключателей (только существующие таблицы).
 */
export function pickTable(
  tables: readonly SeasonStandingsTableRef[],
  me: MySeasonStandings | undefined,
  picked: PickedTable,
): (KnownTable & { classes: BikeClass[]; groups: ResultGroupKey[] }) | null {
  const shown = tables.filter(known);
  const first = shown[0];
  if (!first) return null;
  const classes = [...new Set(shown.map((ref) => ref.bikeClass))];
  const own = me?.items.find((item) => shown.some((ref) => sameTable(ref, item)));
  const bikeClass =
    picked.bikeClass !== undefined && classes.includes(picked.bikeClass)
      ? picked.bikeClass
      : own && own.bikeClass !== 'unknown'
        ? own.bikeClass
        : first.bikeClass;
  const inClass = shown.filter((ref) => ref.bikeClass === bikeClass);
  const table =
    inClass.find((ref) => ref.groupKey === picked.groupKey) ??
    inClass.find((ref) => own !== undefined && sameTable(ref, own)) ??
    inClass[0]!;
  return { ...table, classes, groups: inClass.map((ref) => ref.groupKey) };
}

/** Своя строка в таблице сезона (из `/me`) — по классу и группе. */
export const ownStanding = (me: MySeasonStandings | undefined, key: Key) =>
  me?.items.find((item) => sameTable(item, key));

/**
 * «Вы» — `order` своей строки, только когда таблица и `/me` — один снимок (RC-11: таблица кэшируется 60 с, `/me` —
 * `no-store`; иначе `order` укажет на чужую строку).
 */
export function ownOrder(
  table: SeasonStandingsTable | undefined,
  me: MySeasonStandings | undefined,
): number | null {
  if (!table || !me || table.computedAt === null || table.computedAt !== me.computedAt) return null;
  return ownStanding(me, table)?.order ?? null;
}

/** Итог гонки: «2 · 85 очков», «=3 · 75 очков»; DQ — «DQ · 0» (S11: 0 и не выбрасывается); нет строки — «—». */
export function cellResult(cell: SeasonStandingCell): string {
  if (cell.outcome === 'dq') return t('profile.season.dq');
  if (cell.outcome !== 'placed' || cell.place === null) return '—';
  return `${placeView(cell.place, cell.tied).text} · ${pointsText(cell.points)}`;
}

/** Статус гонки в зачёте: «в зачёте» / «не в зачёте»; нет строки — «нет результата». */
export function cellStatus(cell: SeasonStandingCell): string {
  if (cell.outcome === 'none' || cell.outcome === 'unknown') return t('profile.season.none');
  return t(cell.counted ? 'profile.season.counted' : 'profile.season.notCounted');
}

/** Подпись a11y итога гонки: место словами, DQ, «—» — «нет результата». */
export function cellResultA11y(cell: SeasonStandingCell): string {
  if (cell.outcome === 'placed' && cell.place !== null) {
    return `${placeView(cell.place, cell.tied).a11y}, ${pointsText(cell.points)}`;
  }
  return cell.outcome === 'dq' ? t('profile.season.dq') : t('profile.season.none');
}
