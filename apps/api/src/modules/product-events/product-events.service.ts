import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import type { ProductEvents } from './product-events.port';
import { ProductEventInput } from './product-events.types';
import { ProductEventsRepository } from './product-events.repository';

/** Реализация порта `PRODUCT_EVENTS`: разбор справочником, затем вставка (в транзакции вызывающего, если есть). */
@Injectable()
export class ProductEventsService implements ProductEvents {
  constructor(
    private readonly repository: ProductEventsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async record(event: ProductEventInput, session?: DbSession): Promise<void> {
    const parsed = ProductEventInput.parse(event);
    await this.repository.insert({ ...parsed, _id: uuidv7(), at: this.clock.now() }, session);
  }
}
