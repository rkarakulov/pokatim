export { RoutesCoreModule, RoutesModule, RoutesWorkerModule } from './routes.module';
export { routesOutboxRoutes } from './routes.events';
/** Порт для модуля `races`: готовый маршрут коридора и названия маршрутов. */
export { ROUTE_CATALOG, type ReadyRoute, type RouteCatalog } from './route-catalog.port';
/** Порт для модуля `results`: линия сверки и рамка готового маршрута. */
export { ROUTE_GEOMETRY, type RouteGeometry, type RouteMatchGeometry } from './route-geometry.port';
