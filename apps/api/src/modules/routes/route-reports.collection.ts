import type { RouteReportReason } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Жалобы на маршруты райдеров в каталоге (routes-06). Создаёт миграция `0029_routes_publication`; единственный
 * писатель — `RouteReportsRepository`.
 */
export const ROUTE_REPORTS_COLLECTIONS = { reports: 'route_reports' } as const;

export type RouteReportResolution = 'hidden' | 'dismissed';

/**
 * Жалоба: содержание неизменно; переход — только закрытие (`resolvedAt: null → дата`, `resolution`, `resolvedBy` —
 * один раз). Единственное удаление — вместе с маршрутом (`deleteForRoute` в транзакции удаления, U6, 8.1 RC-5);
 * жалобы удалённого жалобщика хранятся. Одна жалоба на (маршрут, пользователь) — `route_reports_route_reporter_unique`.
 */
export interface RouteReportDoc {
  _id: string;
  routeId: string;
  reporterUserId: string;
  reason: RouteReportReason;
  comment: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: RouteReportResolution | null;
  resolvedBy: string | null;
}

export function routeReportsCollections(db: Db): { reports: Collection<RouteReportDoc> } {
  return { reports: db.collection<RouteReportDoc>(ROUTE_REPORTS_COLLECTIONS.reports) };
}
