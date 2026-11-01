import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { REDIS } from '@rkarakulov/api-kit/core';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { QUEUE } from '../../queues';

/** Все очереди API в порядке `queues.ts`. */
export const QUEUE_NAMES: readonly string[] = Object.values(QUEUE);

/**
 * Очереди BullMQ для экрана «Упавшие задачи»: один `Queue` на имя поверх общего клиента `REDIS` базы (BullMQ помечает
 * переданный клиент `shared` и при `close` его не закрывает) — без своего соединения на каждую из ~30 очередей.
 * Только чтение наборов и действия над конкретной задачей; задач экран не ставит.
 */
@Injectable()
export class FailedJobQueues implements OnModuleDestroy {
  private readonly logger = new Logger(FailedJobQueues.name);
  private readonly queues = new Map<string, Queue>();
  private errorLogged = false;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Очередь по имени из `QUEUE`; незнакомое — `null`. */
  get(name: string): Queue | null {
    if (!QUEUE_NAMES.includes(name)) return null;
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.redis });
      // без слушателя BullMQ пишет каждую ошибку общего клиента в console.error по разу на очередь; об обрыве и так
      // сообщает владелец `REDIS` — здесь одна строка на процесс
      queue.on('error', (error) => {
        if (this.errorLogged) return;
        this.errorLogged = true;
        this.logger.warn(`jobs.queue_error class=${error.constructor.name}`);
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
