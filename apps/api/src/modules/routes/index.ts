export { RoutesCoreModule, RoutesModule, RoutesWorkerModule } from './routes.module';
export {
  ROUTE_PUBLICATION_DECIDED,
  RoutePublicationDecided,
  routesOutboxRoutes,
} from './routes.events';
/** Порт для модуля `races`: готовый маршрут коридора и названия маршрутов. */
export { ROUTE_CATALOG, type ReadyRoute, type RouteCatalog } from './route-catalog.port';
/** Порт для модулей `results` (линия сверки, рамка) и `races` (линия показа для карты). */
export {
  ROUTE_GEOMETRY,
  type RouteDisplayGeometry,
  type RouteGeometry,
  type RouteMatchGeometry,
} from './route-geometry.port';
/** Порт стирания «Моих маршрутов» удалённого аккаунта (модуль `account`). */
export { RouteErasure } from './route-erasure';
/** Порт уведомлений о решении по заявке маршрута райдера (модуль `notifications`, ADR-0017). */
export {
  ROUTE_NOTICES,
  type RouteNotices,
  type RoutePublicationNotice,
} from './route-notices.port';
