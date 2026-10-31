export { ProductEventsCoreModule } from './product-events.module';
/** Порт журнала продуктовых событий (K12): `social`, далее `rides` (P2) и `identity` (P7). */
export { PRODUCT_EVENTS, type ProductEventInput, type ProductEvents } from './product-events.port';
export { PRODUCT_EVENT_TYPES, type ProductEventType } from './product-events.types';
/** Порт стирания журнала удалённого аккаунта (модуль `account`). */
export { ProductEventErasure } from './product-event-erasure';
