export { RoutesCoreModule, RoutesModule, RoutesWorkerModule } from './routes.module';
export { routesOutboxRoutes } from './routes.events';
/** Порт для модуля `races`: готовый маршрут коридора и названия маршрутов. */
export { ROUTE_CATALOG, type ReadyRoute, type RouteCatalog } from './route-catalog.port';
