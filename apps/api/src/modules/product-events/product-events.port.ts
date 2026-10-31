import type { DbSession } from '../../db';
import type { ProductEventInput } from './product-events.types';

/**
 * Порт журнала продуктовых событий (K12, через `modules/product-events/index.ts`): пишут `social`, далее `rides`
 * (источник «Иду», P2) и `identity` (активный день, P7). Коллекцию `product_events` никто, кроме модуля, не пишет.
 */
export const PRODUCT_EVENTS = Symbol('PRODUCT_EVENTS');

export type { ProductEventInput } from './product-events.types';

export interface ProductEvents {
  /**
   * Разбор схемой (неизвестный тип или лишнее поле — throw); `at` — `CLOCK`; с `session` — в транзакции вызывающего.
   * Вызывающий вне транзакции пишет после основной записи и логирует сбой без отказа
   * (`product_events.record_failed type=<t>`).
   */
  record(event: ProductEventInput, session?: DbSession): Promise<void>;
}
