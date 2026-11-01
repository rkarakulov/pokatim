import type { AttendanceVia, ReactionKind, ReactionTargetType } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * «Свои» (social, ADR-0027 п. 2). Создаёт миграция `0045_social`; единственные писатели — репозитории модуля
 * (`connections`, `attendance`, `reactions`, `invite-codes`). Nullable-поля пишутся явным `null`.
 */
export const SOCIAL_COLLECTIONS = {
  connections: 'rider_connections',
  attendance: 'ride_attendance',
  reactions: 'social_reactions',
  inviteCodes: 'invite_codes',
} as const;

/** Общий райд пары с явкой обоих; `at` — старт райда. */
export interface ConnectionRide {
  rideId: string;
  at: Date;
}

/**
 * Направленная связь `ownerId → otherId` (K1), одна на пару (`rider_connections_owner_other_unique`). Источники не
 * хранятся — `connectionSources(doc)`: `ride` — непустой `rides`, `invite` — `inviteAt`, `manual` — `manualAt`.
 * `rideCount` = длина `rides`, `lastRideAt` — max `rides.at`. `removedAt` — тихое удаление (надгробие, RC-6): связь
 * скрыта, пересчёт явки его не сбрасывает и документ не удаляет; ручное добавление сбрасывает.
 */
export interface ConnectionDoc {
  _id: string;
  ownerId: string;
  otherId: string;
  rides: ConnectionRide[];
  rideCount: number;
  lastRideAt: Date | null;
  inviteAt: Date | null;
  manualAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Последнее уведомление «Вас добавили в свои» по паре (K11, P7): не чаще раза в `manualRenotifyMs`. Нет поля —
   * `null` (без миграции); `remove`, пересчёт явки и `EMPTY` его не трогают.
   */
  manualNoticeAt?: Date | null;
}

/** Запись явки райдера (одна на `userId`): явка — `declinedAt: null`; «Меня не было» ставит `declinedAt` (RC-3a). */
export interface AttendanceEntry {
  userId: string;
  via: AttendanceVia;
  at: Date;
  declinedAt: Date | null;
}

/**
 * Явка райда — **один документ на райд** (RC-2a, `_id` = rideId), записей не больше участников райда (≤ 100): все
 * инварианты явки держит один документ, конфликт записи сериализует пересчёты связей (как `rides.participants`).
 */
export interface AttendanceDoc {
  _id: string;
  entries: AttendanceEntry[];
  updatedAt: Date;
  /** захват «Как прошёл райд?» (P5, регламент `social-maintenance`), нет поля — `null`; `updatedAt` не трогает */
  askedAt?: Date | null;
}

/**
 * Реакция (K5, K8): уникальна по `(actorId, kind, targetType, targetId, recipientId)` (RC-1) — «спасибо» одно на пару
 * в райде (`ride_rider`: `targetId` — rideId), «респект» — одно на автора и цель.
 */
export interface ReactionDoc {
  _id: string;
  kind: ReactionKind;
  actorId: string;
  targetType: ReactionTargetType;
  targetId: string;
  recipientId: string;
  createdAt: Date;
}

/** Личный код приглашения (K9, P6): `_id` = userId, `code` уникален. */
export interface InviteCodeDoc {
  _id: string;
  code: string;
  createdAt: Date;
}

export function socialCollections(db: Db): {
  connections: Collection<ConnectionDoc>;
  attendance: Collection<AttendanceDoc>;
  reactions: Collection<ReactionDoc>;
  inviteCodes: Collection<InviteCodeDoc>;
} {
  return {
    connections: db.collection<ConnectionDoc>(SOCIAL_COLLECTIONS.connections),
    attendance: db.collection<AttendanceDoc>(SOCIAL_COLLECTIONS.attendance),
    reactions: db.collection<ReactionDoc>(SOCIAL_COLLECTIONS.reactions),
    inviteCodes: db.collection<InviteCodeDoc>(SOCIAL_COLLECTIONS.inviteCodes),
  };
}
