import { Inject, Injectable, Logger } from '@nestjs/common';
import { addLocalDays, minskDayStartUtc, minskToday } from '@pokatim/contracts';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Redis } from 'ioredis';

import { PRODUCT_EVENTS, type ProductEvents } from '../product-events';

/** Сколько запрос ждёт отметку активного дня (K12, P7): дольше — идёт дальше, отметка завершится в фоне. */
export const ACTIVE_DAY_WAIT_MS = 200;

/** Ключ дедупа: uid и дата Минска — без ПДн. */
export const activeDayKey = (userId: string, day: string) => `active-day:${userId}:${day}`;

/** Срок ключа: до начала следующих суток по Минску плюс час (ретраи у полуночи не дают второго события). */
export function activeDayTtlSec(now: Date): number {
  const nextDay = minskDayStartUtc(addLocalDays(minskToday(now), 1));
  return Math.ceil((nextDay.getTime() - now.getTime()) / 1000) + 3600;
}

const errorKind = (error: unknown) =>
  error instanceof Error ? error.constructor.name : typeof error;

/**
 * Активный день (K12, ADR-0027 п. 7): первый авторизованный запрос райдера за сутки по Минску пишет `active-day` в
 * журнал метрик. Дедуп — Redis `SET NX` до конца суток; сбой записи журнала снимает ключ (следующий запрос повторит).
 * Вне пути ответа: `touch` не бросает и ждёт не дольше `ACTIVE_DAY_WAIT_MS`.
 */
@Injectable()
export class ActiveDay {
  private readonly logger = new Logger(ActiveDay.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PRODUCT_EVENTS) private readonly events: ProductEvents,
  ) {}

  async touch(userId: string, now: Date): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const wait = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ACTIVE_DAY_WAIT_MS);
      timer.unref();
    });
    try {
      await Promise.race([this.mark(userId, now), wait]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async mark(userId: string, now: Date): Promise<void> {
    const day = minskToday(now);
    const key = activeDayKey(userId, day);
    try {
      const claimed = await this.redis.set(key, '1', 'EX', activeDayTtlSec(now), 'NX');
      if (claimed !== 'OK') return;
    } catch (error) {
      this.logger.warn(`product_events.record_failed type=active-day error=${errorKind(error)}`);
      return;
    }
    try {
      await this.events.record({ type: 'active-day', userId, props: { day } });
    } catch (error) {
      await this.redis.del(key).catch(() => undefined);
      this.logger.warn(`product_events.record_failed type=active-day error=${errorKind(error)}`);
    }
  }
}
