import type { CityCode, RideCancelReason, RideStatus } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Кофе-райды (блок 05, ADR-0013 Proposed). Создаёт миграция `0014_rides`; единственный писатель —
 * `RidesRepository`.
 */
export const RIDES_COLLECTIONS = { rides: 'rides' } as const;

export interface RideParticipant {
  userId: string;
  joinedAt: Date;
}

/**
 * Райд. Участники — встроенный массив (≤ `RIDE_MAX_PARTICIPANTS`, организатор — первый) + `goingCount` той же
 * операцией: все инварианты участия держит одна атомарная операция над этим документом (без транзакций и замков).
 * `version` меняют только правки организатора (правка, отмена); участие её не трогает. `organizerName` — подпись,
 * введённая самим организатором (D2), не данные аккаунта.
 */
export interface RideDoc {
  _id: string;
  status: RideStatus;
  organizerUserId: string;
  organizerName: string | null;
  title: string;
  description: string | null;
  startsAt: Date;
  cityCode: CityCode;
  place: string;
  distanceKm: number;
  paceMinKmh: number;
  paceMaxKmh: number;
  limit: number | null;
  participants: RideParticipant[];
  goingCount: number;
  cancelReason: RideCancelReason | null;
  cancelledAt: Date | null;
  /** Время, город или место изменены, когда шли другие участники (`goingCount > 1`). */
  rescheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Публичное чтение: без организатора, участников и `version` (проекция репозитория). */
export type RidePublicDoc = Omit<RideDoc, 'organizerUserId' | 'participants' | 'version'>;

export function ridesCollections(db: Db): { rides: Collection<RideDoc> } {
  return { rides: db.collection<RideDoc>(RIDES_COLLECTIONS.rides) };
}
