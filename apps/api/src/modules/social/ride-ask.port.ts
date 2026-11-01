import { Injectable, Logger } from '@nestjs/common';
import { MongoOutboxWriter } from '@rkarakulov/api-kit/mongo';

import type { DbSession } from '../../db';
import { SOCIAL_RIDE_ASK_DUE, type SocialRideAskDue } from './social.events';

/**
 * Точка привязки уведомления «Как прошёл райд?» (K10, P5 → P7): регламент `social-maintenance` зовёт её в транзакции
 * захвата `askedAt` с адресатами — участниками «Иду» без записи явки, только живые аккаунты. Реализация P7 —
 * `OutboxRideAskDue` (outbox `social.ride-ask-due` в переданной `tx`).
 */
export const RIDE_ASK_DUE = Symbol('RIDE_ASK_DUE');

export interface RideAsk {
  rideId: string;
  /** непуст: райд без адресатов захватывается без вызова */
  userIds: string[];
}

export interface RideAskDue {
  /** В транзакции захвата: сбой откатывает и захват — следующий прогон повторит. */
  due(tx: DbSession, ask: RideAsk): Promise<void>;
}

/**
 * P7: событие `social.ride-ask-due` в транзакции захвата (маршрут — `notificationsOutboxRoutes`); лог
 * `social.ride_ask_due ride=<id> count=<n>` — без id райдеров.
 */
@Injectable()
export class OutboxRideAskDue implements RideAskDue {
  private readonly logger = new Logger(OutboxRideAskDue.name);

  constructor(private readonly outbox: MongoOutboxWriter) {}

  async due(tx: DbSession, ask: RideAsk): Promise<void> {
    const payload: SocialRideAskDue = { rideId: ask.rideId, userIds: ask.userIds };
    await this.outbox.append(tx, { type: SOCIAL_RIDE_ASK_DUE, payload });
    this.logger.log(`social.ride_ask_due ride=${ask.rideId} count=${ask.userIds.length}`);
  }
}
