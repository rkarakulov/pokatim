import type { Collection, Db } from 'mongodb';

import type { ProductEventInput } from './product-events.types';

/**
 * Журнал продуктовых событий (K12, ADR-0027 п. 7). Создаёт миграция `0043_social`; единственный писатель —
 * `ProductEventsRepository`. Append-only: единственное исключение — удаление событий райдера шагом стирания аккаунта
 * (K13).
 */
export const PRODUCT_EVENTS_COLLECTIONS = { events: 'product_events' } as const;

/** Событие: `_id` — uuidv7, `at` — `CLOCK`; `type`/`props` — по справочнику `product-events.types.ts`. */
export type ProductEventDoc = ProductEventInput & { _id: string; at: Date };

export function productEventsCollections(db: Db): { events: Collection<ProductEventDoc> } {
  return { events: db.collection<ProductEventDoc>(PRODUCT_EVENTS_COLLECTIONS.events) };
}
