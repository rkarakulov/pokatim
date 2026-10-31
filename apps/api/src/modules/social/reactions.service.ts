import { Inject, Injectable } from '@nestjs/common';
import type { ReactionKind, ReactionTargetType } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { PRODUCT_EVENTS, type ProductEventInput, type ProductEvents } from '../product-events';
import { AttendanceRepository } from './attendance.repository';
import {
  type ReactionKey,
  REACTIONS_UNIQUE_INDEX,
  ReactionsRepository,
} from './reactions.repository';
import { socialBlocked } from './social.policy';

/** Цель «Респекта» (K8), уже разрешённая вызывающим (порты `RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL` — P4, RC-5). */
export interface RespectTarget {
  targetType: Extract<ReactionTargetType, 'race_entry' | 'route'>;
  targetId: string;
  recipientId: string;
}

/**
 * Реакции (K5, K8): «Спасибо за компанию» — только между явившимися на одном райде, повтор — no-op (RC-4); «Респект» —
 * переключение, себе — нельзя. Гонку двух нажатий держит уникальный индекс (RC-1).
 */
@Injectable()
export class SocialReactionsService {
  constructor(
    private readonly reactions: ReactionsRepository,
    private readonly attendance: AttendanceRepository,
    private readonly transactions: MongoTransactions,
    @Inject(PRODUCT_EVENTS) private readonly events: ProductEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** «Спасибо за компанию» (K5): `true` — новое; уже было — `false` без события. */
  async thank(actorId: string, rideId: string, recipientId: string): Promise<boolean> {
    if (actorId === recipientId) throw socialBlocked('self');
    const attendees = await this.attendance.attendees(rideId);
    if (!attendees.includes(actorId) || !attendees.includes(recipientId)) {
      throw socialBlocked('not_attended');
    }
    const key: ReactionKey = {
      kind: 'thanks',
      actorId,
      targetType: 'ride_rider',
      targetId: rideId,
      recipientId,
    };
    return this.insert(key, { type: 'thanks-sent', userId: actorId, props: {} });
  }

  /** «Респект» (K8): есть — снять (`false`), нет — поставить (`true`). */
  async toggleRespect(actorId: string, target: RespectTarget): Promise<boolean> {
    if (actorId === target.recipientId) throw socialBlocked('self');
    const key: ReactionKey = { kind: 'respect', actorId, ...target };
    if (await this.reactions.delete(key)) return false;
    // параллельное нажатие уже поставило — состояние «поставлен»
    if (
      !(await this.insert(key, {
        type: 'respect-sent',
        userId: actorId,
        props: { targetType: target.targetType },
      }))
    ) {
      return this.reactions.exists(key);
    }
    return true;
  }

  /** Число реакций вида у цели — на чтении, без денормализации (K8: «респект 4»). */
  countFor(targetType: ReactionTargetType, targetId: string, kind: ReactionKind): Promise<number> {
    return this.reactions.count(targetType, targetId, kind);
  }

  /** Вставка с событием в одной транзакции; дубль уникального ключа — `false`. */
  private async insert(key: ReactionKey, event: ProductEventInput): Promise<boolean> {
    try {
      await this.transactions.run(async (tx) => {
        await this.reactions.insert(tx, { _id: uuidv7(), ...key, createdAt: this.clock.now() });
        await this.events.record(event, tx);
      });
      return true;
    } catch (error) {
      if (isDuplicateKey(error, REACTIONS_UNIQUE_INDEX)) return false;
      throw error;
    }
  }
}
