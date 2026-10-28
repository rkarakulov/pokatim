import type { ProfileReportReason } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Жалобы на публичные профили райдеров (profile-moderation). Создаёт миграция `0034_profile_reports`; единственный
 * писатель — `ProfileReportsRepository`.
 */
export const PROFILE_REPORTS_COLLECTIONS = { reports: 'profile_reports' } as const;

export type ProfileReportResolution = 'actioned' | 'dismissed';

/**
 * Жалоба: содержание неизменно; переход — только закрытие (`resolvedAt: null → дата`, `resolution`, `resolvedBy` —
 * один раз, явные `null` до закрытия). Одна **открытая** жалоба на (цель, жалобщик) — частичный уникальный индекс
 * `profile_reports_open_unique`; после закрытия можно пожаловаться снова (S-1). Единственное удаление — жалобы на
 * удалённый аккаунт (`deleteForTarget`, ADR-0015); жалобы удалённого жалобщика хранятся (псевдонимный id).
 */
export interface ProfileReportDoc {
  _id: string;
  targetUserId: string;
  reporterUserId: string;
  reason: ProfileReportReason;
  comment: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: ProfileReportResolution | null;
  resolvedBy: string | null;
}

export function profileReportsCollections(db: Db): { reports: Collection<ProfileReportDoc> } {
  return { reports: db.collection<ProfileReportDoc>(PROFILE_REPORTS_COLLECTIONS.reports) };
}
