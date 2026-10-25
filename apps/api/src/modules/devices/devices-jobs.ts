import { randomBytes } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { QUEUE } from '../../queues';
import { DEVICES_PULL_JOB, type DevicesPullJob } from './devices.events';
import { DEVICES_POLICY } from './devices.policy';

export type PullTrigger = 'schedule' | 'connected' | 'webhook' | 'sync' | 'sync-late';

/**
 * Постановка pull подключения в `devices-sync`. Дедупликация BullMQ по `ow-pull:<connectionId>` (пока задача ждёт
 * — повтор не ставится; во время выполнения — одна следующая, `keepLastIfActive`): расписание, вебхук и «сейчас» не
 * плодят задачи. Отложенный повтор «Синхронизировать сейчас» через 3 мин — свой ключ `ow-pull-late:<id>`
 * (иначе его поглотила бы задача через 30 с). Свой jobId с `:` BullMQ не принимает — ключ задаёт `deduplication.id`.
 */
@Injectable()
export class DevicesPullQueue {
  constructor(@InjectQueue(QUEUE.devicesSync) private readonly queue: Queue) {}

  async schedule(connectionId: string, trigger: PullTrigger, delayMs = 0): Promise<void> {
    const data: DevicesPullJob = { connectionId };
    const key = trigger === 'sync-late' ? 'ow-pull-late' : 'ow-pull';
    await this.queue.add(DEVICES_PULL_JOB, data, {
      deduplication: { id: `${key}:${connectionId}`, keepLastIfActive: true },
      ...(delayMs > 0 ? { delay: delayMs } : {}),
    });
  }
}

/** Освобождение замка — только своего (сравнение токена в Lua). */
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const EXTEND = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

/**
 * Замки Redis модуля (SET NX PX + токен): создание пользователя агрегатора (`devices:account:<userId>`) и pull/отзыв
 * подключения (`devices:pull:<connectionId>` — отзыв ждёт текущий импорт). Истекают сами — упавший процесс не держит
 * их вечно.
 */
@Injectable()
export class DevicesLocks {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Один захват; занят — `null`. */
  async tryAcquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomBytes(16).toString('hex');
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  /** Ждёт замок до `waitMs` (опрос); не дождался — `null`. */
  async acquire(key: string, ttlMs: number, waitMs: number): Promise<string | null> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const token = await this.tryAcquire(key, ttlMs);
      if (token || Date.now() >= deadline) return token;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** Продлить свой замок; `false` — замок истёк или перешёл другому (владение потеряно). */
  async extend(key: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval(EXTEND, 1, key, token, ttlMs);
    return result === 1;
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}

export const accountLockKey = (userId: string) => `devices:account:${userId}`;
export const pullLockKey = (connectionId: string) => `devices:pull:${connectionId}`;
export const ACCOUNT_LOCK = {
  ttlMs: DEVICES_POLICY.accountLockTtlMs,
  waitMs: DEVICES_POLICY.accountLockWaitMs,
} as const;
