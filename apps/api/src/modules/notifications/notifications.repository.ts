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

/** Тикет Expo живёт сутки: квитанции позже не приходят. */
const TICKET_TTL_MS = 24 * 3_600_000;

export type PendingDelivery = Pick<NotificationDoc, '_id' | 'userId' | 'push' | 'email'>;
export type ClaimedPush = Pick<
  NotificationDoc,
  '_id' | 'group' | 'title' | 'body' | 'target' | 'createdAt'
> & { push: Pick<NotificationDoc['push'], 'limitCharged'> };
export type ClaimedEmail = Pick<NotificationDoc, '_id' | 'userId' | 'title' | 'body'>;
/** Снимок токена для снятия (`deleteTokens`): `sessionId` — `null` без сессии, без ключа — не сверяется. */
export interface PushTokenSnapshot {
  _id: string;
  userId: string;
  sessionId?: string | null;
}

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
   * вставке — повтор или устаревшее событие, не ошибка; дубль по `collapseKey` бывает и у более нового события,
   * проигравшего гонку первой вставки старшему, — для него условная замена повторяется без upsert. Возвращает число
   * вставленных и заменённых.
   */
  async writeNotices(docs: readonly NotificationDoc[]): Promise<number> {
    if (docs.length === 0) return 0;
    // условная замена по объекту — по позиции операции; без upsert повторяется после гонки первой вставки
    const collapses = new Map<
      number,
      { filter: Filter<NotificationDoc>; set: Partial<NotificationDoc> }
    >();
    const operations = docs.map((doc, index): AnyBulkWriteOperation<NotificationDoc> => {
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
      const collapse = {
        filter: { userId, collapseKey, sourceEventId: { $lt: sourceEventId } },
        set: { sourceEventId, ...fields },
      };
      collapses.set(index, collapse);
      return {
        updateOne: {
          filter: collapse.filter,
          update: { $set: collapse.set, $setOnInsert: { _id } },
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
      let written = error.result.upsertedCount + error.result.modifiedCount;
      for (const writeError of writeErrors) {
        const collapse = collapses.get(writeError.index);
        if (!collapse || !isDuplicateKey(writeError, NOTIFICATIONS_COLLAPSE_UNIQUE_INDEX)) continue;
        try {
          const retry = await this.notifications.updateOne(collapse.filter, { $set: collapse.set });
          written += retry.modifiedCount;
        } catch (retryError) {
          if (!isRepeatOrStale(retryError)) throw retryError;
        }
      }
      return written;
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
    sessionId: string,
    token: string,
    platform: PushPlatform,
    now: Date,
    maxPerUser: number,
  ): Promise<void> {
    const upsert = () =>
      this.pushTokens.updateOne(
        { token },
        {
          $set: { userId, sessionId, platform, updatedAt: now },
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

  // --- доставка (worker `notifications-delivery`) ---

  /** Уведомления события, ждущие доставки (intake ставит задачи по ним): получатель, push и письмо. */
  pendingDeliveriesOf(sourceEventId: string): Promise<PendingDelivery[]> {
    return this.notifications
      .find(
        {
          sourceEventId,
          $or: [{ 'push.state': 'pending' }, { 'email.state': 'pending' }],
        },
        { projection: { userId: 1, push: 1, email: 1 } },
      )
      .toArray();
  }

  /**
   * Захват push пользователя (как `claimLinkSend`): живые уведомления в `pending` со сроком `notBefore ≤ now` и
   * `sending` с истёкшим захватом (упавший worker) → `sending` с `claimId` и сроком захвата. Каждый документ —
   * атомарно: параллельная задача не захватит тот же документ. Возвращает захваченные, старые первыми.
   */
  async claimPush(
    userId: string,
    now: Date,
    claimId: string,
    claimedUntil: Date,
  ): Promise<ClaimedPush[]> {
    await this.notifications.updateMany(
      {
        userId,
        expireAt: { $gt: now },
        $or: [
          { 'push.state': 'pending', 'push.notBefore': { $lte: now } },
          { 'push.state': 'sending', 'push.claimedUntil': { $lte: now } },
        ],
      },
      {
        $set: {
          'push.state': 'sending',
          'push.claimId': claimId,
          'push.claimedUntil': claimedUntil,
        },
      },
    );
    return this.notifications
      .find(
        { userId, 'push.state': 'sending', 'push.claimId': claimId },
        {
          projection: {
            group: 1,
            title: 1,
            body: 1,
            target: 1,
            createdAt: 1,
            'push.limitCharged': 1,
          },
        },
      )
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
  }

  /**
   * Итог своего захвата push (по `claimId`, только `sending`; `ids` — часть захваченных): `sent`/`skipped`/`limited`/
   * `failed` — захват снят; `pending` — захват снят, `notBefore` — новый срок (тихие часы) или прежний (сбой отправки).
   * Уведомление, заменённое схлопыванием во время отправки, уже не под этим захватом — не трогается.
   */
  async settlePush(
    claimId: string,
    ids: readonly string[] | null,
    outcome:
      | { state: 'sent'; sentAt: Date }
      | { state: 'skipped' | 'limited' | 'failed'; reason: string }
      | { state: 'pending'; notBefore?: Date; limitCharged?: boolean },
  ): Promise<number> {
    const set: Record<string, unknown> = {
      'push.state': outcome.state,
      'push.claimId': null,
      'push.claimedUntil': null,
    };
    if (outcome.state === 'sent') set['push.sentAt'] = outcome.sentAt;
    if ('reason' in outcome) set['push.reason'] = outcome.reason;
    if (outcome.state === 'pending' && outcome.notBefore) set['push.notBefore'] = outcome.notBefore;
    if (outcome.state === 'pending' && outcome.limitCharged) set['push.limitCharged'] = true;
    const result = await this.notifications.updateMany(
      {
        'push.claimId': claimId,
        'push.state': 'sending',
        ...(ids ? { _id: { $in: [...ids] } } : {}),
      },
      { $set: set },
    );
    return result.modifiedCount;
  }

  /**
   * Захват письма уведомления (как `claimLinkSend`): `pending` или `sending` с истёкшим захватом → `sending`;
   * истёкшее (`expireAt ≤ now`, TTL ещё не убрал) не захватывается — как у push.
   * `busy` — живой чужой захват (ретрай задачи); `undefined` — письмо не нужно (нет, отправлено, пропущено).
   */
  async claimEmail(
    id: string,
    now: Date,
    claimedUntil: Date,
  ): Promise<{ status: 'claimed'; doc: ClaimedEmail } | { status: 'busy' } | undefined> {
    const doc = await this.notifications.findOneAndUpdate(
      {
        _id: id,
        expireAt: { $gt: now },
        $or: [
          { 'email.state': 'pending' },
          { 'email.state': 'sending', 'email.claimedUntil': { $lte: now } },
        ],
      },
      { $set: { 'email.state': 'sending', 'email.claimedUntil': claimedUntil } },
      { projection: { userId: 1, title: 1, body: 1 }, returnDocument: 'after' },
    );
    if (doc) return { status: 'claimed', doc };
    const held = await this.notifications.countDocuments({ _id: id, 'email.state': 'sending' });
    return held > 0 ? { status: 'busy' } : undefined;
  }

  /** Итог своего захвата письма (сверка по `claimedUntil`): `pending` — снять захват после сбоя SMTP. */
  async settleEmail(
    id: string,
    claimedUntil: Date,
    outcome: { state: 'sent'; sentAt: Date } | { state: 'skipped' | 'failed' | 'pending' },
  ): Promise<void> {
    await this.notifications.updateOne(
      { _id: id, 'email.state': 'sending', 'email.claimedUntil': claimedUntil },
      {
        $set: {
          'email.state': outcome.state,
          'email.claimedUntil': null,
          ...(outcome.state === 'sent' ? { 'email.sentAt': outcome.sentAt } : {}),
        },
      },
    );
  }

  /**
   * Потерянные задачи push (регламент, без истёкших по `expireAt`): `pending` со сроком раньше `pendingBefore` и `sending` с истёкшим захватом
   * (`notifications_push_due_idx`) — по одному на пользователя с его сроком (jobId задачи).
   */
  async stuckPush(
    pendingBefore: Date,
    now: Date,
    limit: number,
  ): Promise<{ userId: string; notBefore: Date }[]> {
    const rows = await this.notifications
      .aggregate<{ _id: string; notBefore: Date }>([
        {
          $match: {
            expireAt: { $gt: now },
            $or: [
              { 'push.state': 'pending', 'push.notBefore': { $lt: pendingBefore } },
              { 'push.state': 'sending', 'push.claimedUntil': { $lte: now } },
            ],
          },
        },
        { $group: { _id: '$userId', notBefore: { $min: '$push.notBefore' } } },
        { $sort: { notBefore: 1 } },
        { $limit: limit },
      ])
      .toArray();
    return rows.map((row) => ({ userId: row._id, notBefore: row.notBefore }));
  }

  /**
   * Потерянные задачи писем (регламент, без истёкших по `expireAt`): `pending`, созданные раньше `createdBefore`, и
   * истёкший захват `sending`.
   */
  async stuckEmails(createdBefore: Date, now: Date, limit: number): Promise<string[]> {
    const docs = await this.notifications
      .find(
        {
          expireAt: { $gt: now },
          $or: [
            { 'email.state': 'pending', createdAt: { $lt: createdBefore } },
            { 'email.state': 'sending', 'email.claimedUntil': { $lte: now } },
          ],
        },
        { projection: { _id: 1 } },
      )
      .limit(limit)
      .toArray();
    return docs.map((doc) => doc._id);
  }

  /** Токены устройств пользователя (для отправки; в логи не попадают). */
  tokensOf(userId: string): Promise<Pick<PushTokenDoc, '_id' | 'token' | 'sessionId'>[]> {
    return this.pushTokens
      .find({ userId }, { projection: { _id: 1, token: 1, sessionId: 1 } })
      .sort({ updatedAt: 1, _id: 1 })
      .toArray();
  }

  /**
   * Снять токены по снимку, прочитанному при доставке (мёртвая сессия, `DeviceNotRegistered`): документ, который с тех
   * пор перерегистрировали (новый вход, другой владелец устройства), не трогается. `sessionId: null` — токен без
   * сессии; ключа нет (квитанция) — сессия не сверяется.
   */
  async deleteTokens(snapshot: readonly PushTokenSnapshot[]): Promise<number> {
    if (snapshot.length === 0) return 0;
    const result = await this.pushTokens.deleteMany({
      $or: snapshot.map(({ _id, userId, sessionId }) => ({
        _id,
        userId,
        ...(sessionId === undefined
          ? {}
          : { sessionId: sessionId === null ? { $exists: false } : sessionId }),
      })),
    });
    return result.deletedCount;
  }

  /** Тикеты принятых сообщений — до проверки квитанции (TTL 24 ч); владелец — для стирания аккаунта. */
  async insertTickets(
    userId: string,
    tickets: readonly { ticketId: string; tokenId: string }[],
    now: Date,
  ): Promise<void> {
    if (tickets.length === 0) return;
    await this.pushTickets.insertMany(
      tickets.map((ticket) => ({
        _id: uuidv7(),
        ticketId: ticket.ticketId,
        tokenId: ticket.tokenId,
        userId,
        createdAt: now,
        expireAt: new Date(now.getTime() + TICKET_TTL_MS),
      })),
      { ordered: false },
    );
  }

  /**
   * Тикеты, отправленные раньше `before` и ещё живые, старые первыми (`push_tickets_created_idx`); `after` — курсор
   * обхода `(createdAt, _id)` последнего просмотренного: неготовые квитанции не закрывают следующие.
   */
  dueTickets(
    before: Date,
    now: Date,
    limit: number,
    after: NotificationPosition | null = null,
  ): Promise<Pick<PushTicketDoc, '_id' | 'ticketId' | 'tokenId' | 'userId' | 'createdAt'>[]> {
    const filter: Filter<PushTicketDoc> = { createdAt: { $lte: before }, expireAt: { $gt: now } };
    if (after) {
      filter.$or = [
        { createdAt: { $gt: after.createdAt } },
        { createdAt: after.createdAt, _id: { $gt: after.id } },
      ];
    }
    return this.pushTickets
      .find(filter, { projection: { _id: 1, ticketId: 1, tokenId: 1, userId: 1, createdAt: 1 } })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .toArray();
  }

  async deleteTickets(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.pushTickets.deleteMany({ _id: { $in: [...ids] } });
    return result.deletedCount;
  }

  // --- стирание удалённого аккаунта ---

  /**
   * Стереть данные центра пользователя: его тикеты (по владельцу — токены к этому времени уже сняты транзакцией
   * удаления), токены, уведомления, настройки. Повторяемо: второй проход ничего не находит.
   */
  async eraseUser(
    userId: string,
  ): Promise<{ notifications: number; settings: number; tokens: number; tickets: number }> {
    const tickets = (await this.pushTickets.deleteMany({ userId })).deletedCount;
    const tokens = (await this.pushTokens.deleteMany({ userId })).deletedCount;
    const notifications = (await this.notifications.deleteMany({ userId })).deletedCount;
    const settings = (await this.settings.deleteOne({ _id: userId })).deletedCount;
    return { notifications, settings, tokens, tickets };
  }
}
