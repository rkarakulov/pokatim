import { Inject, Injectable } from '@nestjs/common';
import type { ReactionKind, ReactionTargetType } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { PRODUCT_EVENTS, type ProductEventInput, type ProductEvents } from '../product-events';
import { AttendanceRepository } from './attendance.repository';
import {
  type ReactionKey,
  REACTIONS_UNIQUE_INDEX,
  ReactionsRepository,
} from './reactions.repository';
import { SOCIAL_REACTION_CREATED, type SocialReactionCreated } from './social.events';
import { socialBlocked } from './social.policy';

/** Цель «Респекта» (K8), уже разрешённая вызывающим (порты `RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL` — P4, RC-5). */
export interface RespectTarget {
  targetType: Extract<ReactionTargetType, 'race_entry' | 'route'>;
  targetId: string;
  recipientId: string;
}

const thanksKey = (actorId: string, rideId: string, recipientId: string): ReactionKey => ({
  kind: 'thanks',
  actorId,
  targetType: 'ride_rider',
  targetId: rideId,
  recipientId,
});
const thanksEvent = (actorId: string): ProductEventInput => ({
  type: 'thanks-sent',
  userId: actorId,
  props: {},
});

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
    private readonly outbox: MongoOutboxWriter,
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
    return this.insert(thanksKey(actorId, rideId, recipientId), thanksEvent(actorId));
  }

  /**
   * «Поблагодарить всех» (K5, P4 Q1, RC-P4-8): «спасибо» каждому явившемуся, включая непубличных, кроме себя; уже
   * поблагодарённые пропускаются. Актёр не явился — `409 not_attended`. Каждая реакция — своя транзакция `insert`
   * (дубль параллельного нажатия — не новая); частичный сбой — повтор идемпотентен. Результат — сколько новых.
   */
  async thankAll(actorId: string, rideId: string): Promise<number> {
    const attendees = await this.attendance.attendees(rideId);
    if (!attendees.includes(actorId)) throw socialBlocked('not_attended');
    const done = await this.thankedBy(actorId, rideId);
    let added = 0;
    for (const recipientId of attendees) {
      if (recipientId === actorId || done.has(recipientId)) continue;
      if (await this.insert(thanksKey(actorId, rideId, recipientId), thanksEvent(actorId))) {
        added += 1;
      }
    }
    return added;
  }

  /** Кого зритель уже поблагодарил на райде (P4, флаги «Ехали N»). */
  thankedBy(actorId: string, rideId: string): Promise<Set<string>> {
    return this.reactions.recipientsOf(actorId, 'thanks', 'ride_rider', rideId);
  }

  /**
   * Идемпотентный «Респект» (P4, RC-P4-4): `true` — поставить (уже стоит — `false` без события), `false` — снять.
   * Себе — `409 self`. Результат — изменилось ли состояние. HTTP вызывает его, не `toggleRespect`.
   */
  async setRespect(actorId: string, target: RespectTarget, respected: boolean): Promise<boolean> {
    if (actorId === target.recipientId) throw socialBlocked('self');
    const key: ReactionKey = { kind: 'respect', actorId, ...target };
    if (!respected) return this.reactions.delete(key);
    return this.insert(key, {
      type: 'respect-sent',
      userId: actorId,
      props: { targetType: target.targetType },
    });
  }

  /** Поставил ли актёр «Респект» цели. */
  respectedBy(actorId: string, target: RespectTarget): Promise<boolean> {
    return this.reactions.exists({ kind: 'respect', actorId, ...target });
  }

  /** Поставившие «Респект» цели, новые сверху, не больше `limit` (P4: `from` получателю). */
  respectActors(target: Pick<RespectTarget, 'targetType' | 'targetId'>, limit: number) {
    return this.reactions.actorsOf(target.targetType, target.targetId, 'respect', limit);
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

  /**
   * Вставка с событием метрик и outbox `social.reaction-created` (уведомление K10, P7) в одной транзакции; дубль
   * уникального ключа — `false`, без событий. Единственная точка новых реакций (`thank`, `thankAll`,
   * `setRespect(true)`, `toggleRespect`, RC-P4-14).
   */
  private async insert(key: ReactionKey, event: ProductEventInput): Promise<boolean> {
    try {
      await this.transactions.run(async (tx) => {
        const reactionId = uuidv7();
        await this.reactions.insert(tx, { _id: reactionId, ...key, createdAt: this.clock.now() });
        await this.events.record(event, tx);
        const payload: SocialReactionCreated = { reactionId };
        await this.outbox.append(tx, { type: SOCIAL_REACTION_CREATED, payload });
      });
      return true;
    } catch (error) {
      if (isDuplicateKey(error, REACTIONS_UNIQUE_INDEX)) return false;
      throw error;
    }
  }
}
