import { Inject, Injectable } from '@nestjs/common';
import { type NotificationSettings, type PushPlatform, UNREAD_COUNT_MAX } from '@pokatim/contracts';
import { isDuplicateKey, MONGO_DB, uuidv7 } from '@rkarakulov/api-kit/mongo';
import {
  type AnyBulkWriteOperation,
  type Collection,
  type Db,
  type Filter,
  MongoBulkWriteError,
} from 'mongodb';

import type { DbSession } from '../../db';
import {
  type NotificationDoc,
  type NotificationSettingsDoc,
  notificationsCollections,
  type PushTicketDoc,
  type PushTokenDoc,
} from './notifications.collection';

/** Уникальность токена устройства — гонка двух первых регистраций одного токена (`isDuplicateKey`). */
export const PUSH_TOKENS_TOKEN_UNIQUE_INDEX = 'push_tokens_token_unique';

/** Одно уведомление на `(sourceEventId, userId)` — повтор события (`isDuplicateKey`). */
export const NOTIFICATIONS_EVENT_USER_UNIQUE_INDEX = 'notifications_event_user_unique';
/** Одно уведомление на `(userId, collapseKey)` — устаревшее или повторное событие по объекту (N7). */
export const NOTIFICATIONS_COLLAPSE_UNIQUE_INDEX = 'notifications_collapse_unique';

const isRepeatOrStale = (error: unknown) =>
  isDuplicateKey(error, NOTIFICATIONS_EVENT_USER_UNIQUE_INDEX) ||
  isDuplicateKey(error, NOTIFICATIONS_COLLAPSE_UNIQUE_INDEX);

/** Позиция курсора списка: `(createdAt, _id)` последнего показанного. */
export interface NotificationPosition {
  createdAt: Date;
  id: string;
}

/**
 * Единственный писатель коллекций центра уведомлений (`notifications.collection.ts`). Каждая выборка и мутация
 * приложения — с `userId` из сессии в фильтре (чужое не видно и не меняется); значения фильтров — примитивы после zod.
 * Истечение (`expireAt`) проверяется по `CLOCK` в запросе: TTL-индекс — только уборка.
 */
@Injectable()
export class NotificationsRepository {
  private readonly notifications: Collection<NotificationDoc>;
  private readonly settings: Collection<NotificationSettingsDoc>;
  private readonly pushTokens: Collection<PushTokenDoc>;
  private readonly pushTickets: Collection<PushTicketDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    ({
      notifications: this.notifications,
      settings: this.settings,
      pushTokens: this.pushTokens,
      pushTickets: this.pushTickets,
    } = notificationsCollections(db));
  }

  // --- уведомления ---

  /** Страница своих живых уведомлений, новые сверху (`notifications_user_list_idx`); `limit` — с запасом на «есть ещё». */
  list(
    userId: string,
    now: Date,
    limit: number,
    after: NotificationPosition | null,
  ): Promise<NotificationDoc[]> {
    const filter: Filter<NotificationDoc> = { userId, expireAt: { $gt: now } };
    if (after) {
      filter.$or = [
        { createdAt: { $lt: after.createdAt } },
        { createdAt: after.createdAt, _id: { $lt: after.id } },
      ];
    }
    return this.notifications
      .find(filter, {
        projection: {
          kind: 1,
          group: 1,
          title: 1,
          body: 1,
          target: 1,
          createdAt: 1,
          readAt: 1,
        },
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Запись уведомлений события (intake), одна пачка — один `bulkWrite` без порядка. Без `collapseKey` — вставка, если
   * `(sourceEventId, userId)` ещё нет (`$setOnInsert`: повтор задачи ничего не меняет). С `collapseKey` (N7) — замена
   * прежнего уведомления объекта только более старым событием (`sourceEventId $lt`: uuidv7 упорядочены по времени):
   * текст, цель, снова непрочитано, наверху (`createdAt`), доставка заново; совпадения нет — вставка. Дубль ключа на
   * вставке — повтор или устаревшее событие, не ошибка. Возвращает число вставленных и заменённых.
   */
  async writeNotices(docs: readonly NotificationDoc[]): Promise<number> {
    if (docs.length === 0) return 0;
    const operations = docs.map((doc): AnyBulkWriteOperation<NotificationDoc> => {
      const { _id, userId, sourceEventId, collapseKey, ...fields } = doc;
      if (collapseKey === undefined) {
        return {
          updateOne: {
            filter: { sourceEventId, userId },
            update: { $setOnInsert: { _id, ...fields } },
            upsert: true,
          },
        };
      }
      return {
        updateOne: {
          filter: { userId, collapseKey, sourceEventId: { $lt: sourceEventId } },
          update: { $set: { sourceEventId, ...fields }, $setOnInsert: { _id } },
          upsert: true,
        },
      };
    });
    try {
      const result = await this.notifications.bulkWrite(operations, { ordered: false });
      return result.upsertedCount + result.modifiedCount;
    } catch (error) {
      if (!(error instanceof MongoBulkWriteError)) throw error;
      const writeErrors = Array.isArray(error.writeErrors)
        ? error.writeErrors
        : [error.writeErrors];
      if (writeErrors.length === 0 || !writeErrors.every(isRepeatOrStale)) throw error;
      return error.result.upsertedCount + error.result.modifiedCount;
    }
  }

  /** Непрочитанные живые, не больше `UNREAD_COUNT_MAX` (`notifications_user_unread_idx`). */
  unreadCount(userId: string, now: Date): Promise<number> {
    return this.notifications.countDocuments(
      { userId, readAt: null, expireAt: { $gt: now } },
      { limit: UNREAD_COUNT_MAX },
    );
  }

  /**
   * Отметить своё живое уведомление прочитанным; уже прочитанное сохраняет прежний `readAt`. `false` — нет такого у
   * пользователя (чужое, неизвестное, истёкшее).
   */
  async markRead(userId: string, id: string, now: Date): Promise<boolean> {
    const result = await this.notifications.updateOne({ _id: id, userId, expireAt: { $gt: now } }, [
      { $set: { readAt: { $ifNull: ['$readAt', { $literal: now }] } } },
    ]);
    return result.matchedCount === 1;
  }

  /** «Прочитать все» — свои непрочитанные. */
  async markAllRead(userId: string, now: Date): Promise<number> {
    const result = await this.notifications.updateMany(
      { userId, readAt: null },
      { $set: { readAt: now } },
    );
    return result.modifiedCount;
  }

  // --- настройки ---

  /** Сохранённые настройки или `null` (тогда — умолчания). */
  async findSettings(userId: string): Promise<NotificationSettings | null> {
    const doc = await this.settings.findOne(
      { _id: userId },
      { projection: { _id: 0, push: 1, email: 1, quietHours: 1 } },
    );
    return doc ?? null;
  }

  /** Сохранённые настройки пользователей пачкой (`_id $in`); нет документа — нет в карте (умолчания). */
  async findSettingsMany(userIds: readonly string[]): Promise<Map<string, NotificationSettings>> {
    if (userIds.length === 0) return new Map();
    const docs = await this.settings
      .find({ _id: { $in: [...userIds] } }, { projection: { push: 1, email: 1, quietHours: 1 } })
      .toArray();
    return new Map(
      docs.map((doc) => [
        doc._id,
        { push: doc.push, email: doc.email, quietHours: doc.quietHours },
      ]),
    );
  }

  /** Полная замена настроек (один документ, `_id = userId`). */
  async saveSettings(userId: string, settings: NotificationSettings, now: Date): Promise<void> {
    await this.settings.replaceOne(
      { _id: userId },
      {
        push: { ...settings.push },
        email: { ...settings.email },
        quietHours: { ...settings.quietHours },
        updatedAt: now,
      },
      { upsert: true },
    );
  }

  // --- push-токены ---

  /**
   * Регистрация токена устройства: токен глобально уникален — уже известный переходит к этому пользователю (устройство
   * одно), платформа и `updatedAt` обновляются. Гонка двух первых upsert — `isDuplicateKey` и один повтор (второй
   * найдёт документ). Затем сверх `maxPerUser` вытесняются старейшие по `updatedAt`.
   */
  async registerToken(
    userId: string,
    token: string,
    platform: PushPlatform,
    now: Date,
    maxPerUser: number,
  ): Promise<void> {
    const upsert = () =>
      this.pushTokens.updateOne(
        { token },
        {
          $set: { userId, platform, updatedAt: now },
          $setOnInsert: { _id: uuidv7(), token, createdAt: now },
        },
        { upsert: true },
      );
    try {
      await upsert();
    } catch (error) {
      if (!isDuplicateKey(error, PUSH_TOKENS_TOKEN_UNIQUE_INDEX)) throw error;
      await upsert();
    }
    const excess = await this.pushTokens
      .find({ userId }, { projection: { _id: 1 } })
      .sort({ updatedAt: -1, _id: -1 })
      .skip(maxPerUser)
      .toArray();
    if (excess.length > 0) {
      await this.pushTokens.deleteMany({ userId, _id: { $in: excess.map((doc) => doc._id) } });
    }
  }

  /** Снять свой токен; чужой и неизвестный — без эффекта. */
  async revokeToken(userId: string, token: string): Promise<number> {
    const result = await this.pushTokens.deleteOne({ userId, token });
    return result.deletedCount;
  }

  /** Снять все токены пользователя (в транзакции удаления аккаунта). */
  async revokeAllTokens(tx: DbSession, userId: string): Promise<number> {
    const result = await this.pushTokens.deleteMany({ userId }, { session: tx });
    return result.deletedCount;
  }

  // --- стирание удалённого аккаунта ---

  /**
   * Стереть данные центра пользователя: тикеты его токенов, токены, уведомления, настройки. Повторяемо: второй проход
   * ничего не находит.
   */
  async eraseUser(
    userId: string,
  ): Promise<{ notifications: number; settings: number; tokens: number; tickets: number }> {
    const tokenIds = (
      await this.pushTokens.find({ userId }, { projection: { _id: 1 } }).toArray()
    ).map((doc) => doc._id);
    const tickets =
      tokenIds.length > 0
        ? (await this.pushTickets.deleteMany({ tokenId: { $in: tokenIds } })).deletedCount
        : 0;
    const tokens = (await this.pushTokens.deleteMany({ userId })).deletedCount;
    const notifications = (await this.notifications.deleteMany({ userId })).deletedCount;
    const settings = (await this.settings.deleteOne({ _id: userId })).deletedCount;
    return { notifications, settings, tokens, tickets };
  }
}
