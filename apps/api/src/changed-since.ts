import type { Filter } from 'mongodb';

/**
 * Keyset «изменилось после» по `(updatedAt, _id)` — пререндер OG-картинок (`og.sync`, og-images) в модулях-владельцах
 * (`races`, `rides`, `routes`, `calendar`). Общий, как `page-cursor.ts`: одна реализация фильтра и сортировки.
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

/** Строго после курсора; `null` — с начала. */
export function changedAfter(
  after: ChangedCursor | null,
): Filter<{ _id: string; updatedAt: Date }> {
  if (!after) return {};
  return {
    $or: [{ updatedAt: { $gt: after.at } }, { updatedAt: after.at, _id: { $gt: after.id } }],
  };
}

export const CHANGED_SORT = { updatedAt: 1, _id: 1 } as const;
