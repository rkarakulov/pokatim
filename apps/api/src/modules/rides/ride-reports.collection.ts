import type { RideReportReason } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Жалобы на кофе-райды (05b). Создаёт миграция `0017_ride_reports`; единственный писатель — `RideReportsRepository`.
 */
export const RIDE_REPORTS_COLLECTIONS = { reports: 'ride_reports' } as const;

export type RideReportResolution = 'hidden' | 'dismissed';

/**
 * Жалоба: содержание неизменно; единственный переход — закрытие (`resolvedAt: null → дата`, `resolution`,
 * `resolvedBy` — один раз, без удаления). Решение и причина — в append-only журнале панели. Одна жалоба на
 * (райд, пользователь) — уникальный индекс `ride_reports_ride_reporter_unique`.
 */
export interface RideReportDoc {
  _id: string;
  rideId: string;
  reporterUserId: string;
  reason: RideReportReason;
  comment: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: RideReportResolution | null;
  resolvedBy: string | null;
}

export function rideReportsCollections(db: Db): { reports: Collection<RideReportDoc> } {
  return { reports: db.collection<RideReportDoc>(RIDE_REPORTS_COLLECTIONS.reports) };
}
