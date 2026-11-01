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
/** Порт для модуля `rides` (05c): маршрут райда — видимость на каждом чтении, без кэша. */
export { RIDE_ROUTES, type RideRouteRef, type RideRoutes } from './ride-routes.port';
/** Порт для модуля `route-rides` (route-rides-01): маршрут, видимый райдеру сейчас, и линия сверки — без кэша. */
export {
  ROUTE_RIDE_ROUTES,
  type RideableRoute,
  type RouteRideRoutes,
} from './route-ride-routes.port';
/** Порт OG-картинки маршрута каталога для `sharing` (og-images): факты, линия показа, пререндер. */
export {
  type RouteOgFacts,
  ROUTES_FOR_SHARING,
  type RoutesForSharing,
} from './routes-for-sharing.port';
/** Порт «Обзора» панели (admin-overview): заявки в каталог и маршруты с жалобами. */
export { RoutesOverview } from './routes-overview';
/** Порт для `social` («Свои» P4): маршрут райдера в каталоге — цель «Респекта автору» (K8). */
export {
  ROUTES_FOR_SOCIAL,
  type RouteRespectTarget,
  type RoutesForSocial,
} from './routes-for-social.port';
