import type { Filter } from 'mongodb';

/** Фильтр по `_id` и полю времени `K`. */
type Timed<K extends string> = Filter<{ _id: string } & Record<K, Date>>;

/**
 * Keyset «изменилось после» по `(<поле времени>, _id)` — пререндер OG-картинок (`og.sync`, og-images; поле
 * `updatedAt`) и серверная сверка достижений (`achievements.sweep`, achievements-push; окно `changedWithin` — `startsAt`, `updatedAt`) в
 * модулях-владельцах. Общий, как `page-cursor.ts`: одна реализация фильтра и сортировки.
 */
export interface ChangedCursor {
  at: Date;
  id: string;
}

/** Строка «изменилось»: id и момент изменения. */
export interface ChangedRow {
  id: string;
  updatedAt: Date;
}

/**
 * Страница источника серверной сверки достижений (achievements-push): райдеры строк окна и курсор после последней
 * прочитанной строки (`null` — строк нет, курсор прежний); полная страница — продолжение следующим прогоном.
 */
export interface RiderChanges {
  userIds: string[];
  next: ChangedCursor | null;
}

/** Строго после курсора по `(updatedAt, _id)`; `null` — с начала. */
export function changedAfter(after: ChangedCursor | null): Timed<'updatedAt'> {
  if (!after) return {};
  return {
    $or: [{ updatedAt: { $gt: after.at } }, { updatedAt: after.at, _id: { $gt: after.id } }],
  };
}

/**
 * Окно `(курсор, until]` по `(field, _id)`: диапазон поля ограничен с двух сторон (скан индекса `(field, _id)` только по
 * окну), строки с временем курсора — с большим `_id`. Пустой `id` курсора — время курсора включительно (старт без
 * прочитанных строк).
 */
export function changedWithin<K extends string>(
  after: ChangedCursor,
  until: Date,
  field: K,
): Timed<K> {
  const range = { [field]: { $gte: after.at, $lte: until } };
  if (after.id === '') return range as Timed<K>;
  return {
    ...range,
    $or: [{ [field]: { $gt: after.at } }, { _id: { $gt: after.id } }],
  } as Timed<K>;
}

/** Сортировка keyset — `(field, _id)` по возрастанию. */
export const changedSort = <K extends string>(field: K) =>
  ({ [field]: 1, _id: 1 }) as { [P in K]: 1 } & { _id: 1 };

export const CHANGED_SORT = changedSort('updatedAt');

/**
 * Наименьший uuidv7 момента `at` (первые 48 бит — Unix-время в мс, RFC 9562 §5.7; версия и вариант — минимальные):
 * строки uuidv7 сравниваются как время — окно по `_id` без поля времени (журнал ревизий протоколов).
 */
export function uuidv7Floor(at: Date): string {
  const hex = at.getTime().toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
}

/**
 * Keyset по стабильному ключу `_id` ↑ (карта сайта, sitemap-index): строго после `afterId`; `null` — с начала. uuidv7 —
 * новые строки в конце, правка строки её не переносит.
 */
export const idAfter = (afterId: string | null): Filter<{ _id: string }> =>
  afterId === null ? {} : { _id: { $gt: afterId } };

export const ID_SORT = { _id: 1 } as const;
