import type { RideStatus } from '@pokatim/contracts';

/**
 * Порт `rides` для модуля `notifications` (ADR-0017; через `modules/rides/index.ts`): поля текста и получатели
 * уведомлений о райдах. `notifications` райды и жалобы напрямую не читает; подпись организатора, описание
 * и комментарии жалоб сюда не попадают (N12).
 */
export const RIDE_NOTICES = Symbol('RIDE_NOTICES');

export interface RideNotice {
  id: string;
  title: string;
  startsAt: Date;
  status: RideStatus;
  organizerUserId: string;
  goingCount: number;
  /** участники «Иду» без организатора */
  participantUserIds: string[];
}

export interface RideNotices {
  ride(rideId: string): Promise<RideNotice | null>;
  /** Авторы жалоб, закрытых действием модерации в момент `resolvedAt` (RC-3). */
  resolvedReporters(rideId: string, resolvedAt: Date): Promise<string[]>;
}
