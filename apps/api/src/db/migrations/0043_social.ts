import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, IndexSpecification } from 'mongodb';

import { PRODUCT_EVENTS_COLLECTIONS } from '../../modules/product-events/product-events.collection';
import { SOCIAL_COLLECTIONS } from '../../modules/social/social.collection';
import { ensureCollection } from './0002_identity';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/**
 * Индексы «Свои» (ADR-0027 п. 2). Связи: одна на пару (список владельца, K6, стирание «мои»), обратный — стирание «ко
 * мне» и аудитория «Свои идут» (P7), по райду — существующие пары при пересчёте явки. Явка (документ на райд, RC-2a) —
 * по райдеру (стирание, «мои явки»). Реакции: уникальность с получателем (RC-1), счётчик по цели, полученные (имена
 * получателю, стирание). Коды приглашений — уникальный код. Журнал метрик — стирание по `userId`, выгрузка по типу.
 */
export const SOCIAL_INDEXES = {
  [SOCIAL_COLLECTIONS.connections]: [
    {
      key: { ownerId: 1, otherId: 1 },
      options: { name: 'rider_connections_owner_other_unique', unique: true },
    },
    { key: { otherId: 1, ownerId: 1 }, options: { name: 'rider_connections_other_idx' } },
    { key: { 'rides.rideId': 1 }, options: { name: 'rider_connections_ride_idx' } },
  ],
  [SOCIAL_COLLECTIONS.attendance]: [
    { key: { 'entries.userId': 1 }, options: { name: 'ride_attendance_user_idx' } },
  ],
  [SOCIAL_COLLECTIONS.reactions]: [
    {
      key: { actorId: 1, kind: 1, targetType: 1, targetId: 1, recipientId: 1 },
      options: { name: 'social_reactions_unique', unique: true },
    },
    {
      key: { targetType: 1, targetId: 1, kind: 1 },
      options: { name: 'social_reactions_target_idx' },
    },
    {
      key: { recipientId: 1, kind: 1, createdAt: -1 },
      options: { name: 'social_reactions_recipient_idx' },
    },
  ],
  [SOCIAL_COLLECTIONS.inviteCodes]: [
    { key: { code: 1 }, options: { name: 'invite_codes_code_unique', unique: true } },
  ],
  [PRODUCT_EVENTS_COLLECTIONS.events]: [
    { key: { userId: 1 }, options: { name: 'product_events_user_idx' } },
    { key: { type: 1, at: 1 }, options: { name: 'product_events_type_at_idx' } },
  ],
} as const satisfies Record<string, readonly IndexDef[]>;

/**
 * «Свои», этап 0 (ADR-0027): коллекции `rider_connections`, `ride_attendance`, `social_reactions`, `invite_codes`,
 * `product_events` и индексы. Expand-only, без транзакции и бэкфилла, идемпотентна. После
 * `0042_profile_report_reasons`.
 */
export const social: MongoMigration = {
  id: '0043_social',
  async up(db) {
    for (const [name, indexes] of Object.entries(SOCIAL_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
