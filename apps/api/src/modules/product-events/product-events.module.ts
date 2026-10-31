import { Module } from '@nestjs/common';

import { ProductEventErasure } from './product-event-erasure';
import { PRODUCT_EVENTS } from './product-events.port';
import { ProductEventsRepository } from './product-events.repository';
import { ProductEventsService } from './product-events.service';

/**
 * Журнал продуктовых событий (K12, ADR-0027 п. 7) — листовой модуль: других модулей API не импортирует (`MONGO_DB`,
 * `CLOCK` — глобальные). Порт записи `PRODUCT_EVENTS` и порт стирания `ProductEventErasure` (`account`).
 */
@Module({
  providers: [
    ProductEventsRepository,
    ProductEventsService,
    { provide: PRODUCT_EVENTS, useExisting: ProductEventsService },
    ProductEventErasure,
  ],
  exports: [PRODUCT_EVENTS, ProductEventErasure],
})
export class ProductEventsCoreModule {}
