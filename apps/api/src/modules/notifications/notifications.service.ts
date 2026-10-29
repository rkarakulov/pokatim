import { Inject, Injectable } from '@nestjs/common';
import {
  type NotificationListQuery,
  type NotificationPage,
  type NotificationView,
  type UnreadCount,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { z } from 'zod';

import { domainError } from '../../error-messages';
import { consumeUserLimit } from '../../user-limit';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import type { NotificationDoc } from './notifications.collection';
import { NOTIFICATIONS_POLICY } from './notifications.policy';
import { NotificationsRepository } from './notifications.repository';

type ListedDoc = Pick<
  NotificationDoc,
  '_id' | 'kind' | 'group' | 'title' | 'body' | 'target' | 'createdAt' | 'readAt'
>;

/** Ответ — явный список полей: без `userId`, источника, состояния доставки. */
function viewOf(doc: ListedDoc): NotificationView {
  return {
    id: doc._id,
    kind: doc.kind,
    group: doc.group,
    title: doc.title,
    body: doc.body,
    createdAt: doc.createdAt.toISOString(),
    read: (doc.readAt ?? null) !== null,
    target: doc.target ?? null,
  };
}

/**
 * Центр уведомлений вошедшего райдера (ADR-0017, N9): список с курсором, счётчик, прочтение. Только свои — `userId`
 * из сессии в каждом фильтре; чужое и неизвестное уведомление — один `404 NOT_FOUND`.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(userId: string, query: NotificationListQuery): Promise<NotificationPage> {
    const after = query.cursor ? decodeCursor(query.cursor, z.iso.datetime()) : null;
    const now = this.clock.now();
    const docs = await this.repository.list(
      userId,
      now,
      query.limit + 1,
      after ? { createdAt: new Date(after.k), id: after.id } : null,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(viewOf),
      nextCursor:
        docs.length > query.limit && last
          ? encodeCursor(last.createdAt.toISOString(), last._id)
          : null,
    };
  }

  async unreadCount(userId: string): Promise<UnreadCount> {
    return { count: await this.repository.unreadCount(userId, this.clock.now()) };
  }

  /** Прочитать своё (повтор — тоже успех); чужое, неизвестное, истёкшее — 404. */
  async markRead(userId: string, id: string): Promise<void> {
    const now = this.clock.now();
    await this.limitReads(userId, now);
    if (!(await this.repository.markRead(userId, id, now))) throw domainError('NOT_FOUND', 404);
  }

  async markAllRead(userId: string): Promise<void> {
    const now = this.clock.now();
    await this.limitReads(userId, now);
    await this.repository.markAllRead(userId, now);
  }

  private limitReads(userId: string, now: Date): Promise<void> {
    return consumeUserLimit(
      this.rateLimiter,
      `notifications-read:${userId}`,
      NOTIFICATIONS_POLICY.readLimit,
      now,
    );
  }
}
