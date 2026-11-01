import { Injectable, Logger } from '@nestjs/common';

import type { DbSession } from '../../db';

/**
 * Точка привязки уведомления «Как прошёл райд?» (K10, P5 → P7): регламент `social-maintenance` зовёт её в транзакции
 * захвата `askedAt` с адресатами — участниками «Иду» без записи явки, только живые аккаунты. P7 подменяет провайдер
 * (например, outbox в переданной `tx`); в P5 — заглушка `LoggingRideAskDue`.
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

/** Заглушка P5: только лог `social.ride_ask_due ride=<id> count=<n>`, без id райдеров. */
@Injectable()
export class LoggingRideAskDue implements RideAskDue {
  private readonly logger = new Logger(LoggingRideAskDue.name);

  due(_tx: DbSession, ask: RideAsk): Promise<void> {
    this.logger.log(`social.ride_ask_due ride=${ask.rideId} count=${ask.userIds.length}`);
    return Promise.resolve();
  }
}
