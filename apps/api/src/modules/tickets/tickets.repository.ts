import { Inject, Injectable } from '@nestjs/common';
import type { TicketEmailState, TicketEventKind } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type EventRegistrationDoc,
  type EventTicketingDoc,
  type TicketCategoryDoc,
  type TicketDoc,
  type TicketsCollections,
  ticketingIdOf,
  ticketsCollections,
} from './tickets.collection';

/** Счётчики билетов события для панели. */
export interface TicketCounts {
  active: number;
  checkedIn: number;
}

/**
 * Единственный писатель `event_ticketing`, `event_registrations`, `tickets` (event-tickets). Значения фильтров —
 * примитивы после zod и id сервера. Правила:
 * - настройки — замена по ожидаемой `version` (`findOneAndUpdate`/вставка с `_id`; дубль `_id_` — устаревшая версия);
 * - места календаря — условный `$inc registeredCount` (`reserveSeat`) первой операцией транзакции регистрации: две
 *   регистрации и правка `capacity` конфликтуют по документу настроек;
 * - переходы билета — условием текущего статуса в фильтре (`markCheckedIn`: только `active`);
 * - письмо — захват `email.state` одним `findOneAndUpdate` (как уведомления, RC-T11).
 */
@Injectable()
export class TicketsRepository {
  private readonly c: TicketsCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = ticketsCollections(db);
  }

  // --- настройки ---

  async findTicketing(
    kind: TicketEventKind,
    eventId: string,
    session?: DbSession,
  ): Promise<EventTicketingDoc | undefined> {
    return (
      (await this.c.ticketing.findOne({ _id: ticketingIdOf(kind, eventId) }, { session })) ??
      undefined
    );
  }

  async findTicketings(ids: readonly string[]): Promise<EventTicketingDoc[]> {
    if (ids.length === 0) return [];
    return this.c.ticketing.find({ _id: { $in: [...new Set(ids)] } }).toArray();
  }

  /**
   * Запись настроек по ожидаемой версии: нет документа — вставка (`expectedVersion` 0; гонка двух первых — дубль
   * `_id_`), иначе замена полей при совпадении `version`. `false` — версия устарела.
   */
  async upsertTicketing(
    tx: DbSession,
    doc: EventTicketingDoc,
    expectedVersion: number,
  ): Promise<boolean> {
    if (expectedVersion === 0) {
      await this.c.ticketing.insertOne(doc, { session: tx });
      return true;
    }
    // `registeredCount` пишет только регистрация (`reserveSeat`/`releaseSeat`)
    const updated = await this.c.ticketing.updateOne(
      { _id: doc._id, version: expectedVersion },
      {
        $set: {
          enabled: doc.enabled,
          startsAt: doc.startsAt,
          endsAt: doc.endsAt,
          place: doc.place,
          address: doc.address,
          instructions: doc.instructions,
          capacity: doc.capacity,
          version: doc.version,
          updatedAt: doc.updatedAt,
          updatedBy: doc.updatedBy,
        },
      },
      { session: tx },
    );
    return updated.matchedCount === 1;
  }

  /**
   * Включённые настройки гонок для регламента сверки: старт позже `startsAfter` (`now − 61 сут`: окно гонки ≤ 60 суток,
   * очный старт внутри него) — диапазон по `event_ticketing_enabled_idx`, давние гонки не читаются.
   */
  enabledRaceTicketings(startsAfter: Date): Promise<EventTicketingDoc[]> {
    return this.c.ticketing
      .find({ kind: 'race', enabled: true, startsAt: { $gt: startsAfter } })
      .toArray();
  }

  /**
   * Занять место на старте календаря — **первая** операция транзакции регистрации: условный `$inc` при включённых
   * билетах и свободном месте. `null` — выключено или мест нет (различает вызывающий).
   */
  reserveSeat(tx: DbSession, eventId: string): Promise<EventTicketingDoc | null> {
    return this.c.ticketing.findOneAndUpdate(
      {
        _id: ticketingIdOf('calendar', eventId),
        enabled: true,
        $or: [{ capacity: null }, { $expr: { $lt: ['$registeredCount', '$capacity'] } }],
      },
      { $inc: { registeredCount: 1 } },
      { session: tx, returnDocument: 'after' },
    );
  }

  /** Освободить место (отмена регистрации в той же транзакции). */
  async releaseSeat(tx: DbSession, eventId: string): Promise<void> {
    await this.c.ticketing.updateOne(
      { _id: ticketingIdOf('calendar', eventId), registeredCount: { $gt: 0 } },
      { $inc: { registeredCount: -1 } },
      { session: tx },
    );
  }

  // --- регистрации календаря ---

  async insertRegistration(tx: DbSession, doc: EventRegistrationDoc): Promise<void> {
    await this.c.registrations.insertOne(doc, { session: tx });
  }

  async activeRegistration(
    eventId: string,
    userId: string,
    session?: DbSession,
  ): Promise<EventRegistrationDoc | undefined> {
    return (
      (await this.c.registrations.findOne({ eventId, userId, status: 'active' }, { session })) ??
      undefined
    );
  }

  /** Отмена регистрации: только `active`; `false` — уже отменена. */
  async cancelRegistration(tx: DbSession, id: string, now: Date): Promise<boolean> {
    const updated = await this.c.registrations.updateOne(
      { _id: id, status: 'active' },
      { $set: { status: 'cancelled', cancelledAt: now } },
      { session: tx },
    );
    return updated.modifiedCount === 1;
  }

  /** Активные регистрации пользователя (стирание аккаунта). */
  activeRegistrationsOf(userId: string): Promise<EventRegistrationDoc[]> {
    return this.c.registrations.find({ userId, status: 'active' }).toArray();
  }

  // --- билеты ---

  async insertTicket(tx: DbSession, doc: TicketDoc): Promise<void> {
    await this.c.tickets.insertOne(doc, { session: tx });
  }

  async findTicket(id: string): Promise<TicketDoc | undefined> {
    return (await this.c.tickets.findOne({ _id: id })) ?? undefined;
  }

  async findByRegistration(
    registrationId: string,
    session?: DbSession,
  ): Promise<TicketDoc | undefined> {
    return (await this.c.tickets.findOne({ registrationId }, { session })) ?? undefined;
  }

  /**
   * Замок настроек события в транзакции check-in: запись в документ настроек (`checkInLock`, без `version`) —
   * конфликт с выключением билетов (`PUT`). Нет настроек — `null`.
   */
  lockTicketing(
    tx: DbSession,
    kind: TicketEventKind,
    eventId: string,
  ): Promise<EventTicketingDoc | null> {
    return this.c.ticketing.findOneAndUpdate(
      { _id: ticketingIdOf(kind, eventId) },
      { $inc: { checkInLock: 1 } },
      { session: tx, returnDocument: 'after' },
    );
  }

  /**
   * Замок активной регистрации в транзакции check-in (`$inc version` документа регистрации): конфликт с отменой
   * регистрации. Не активна или нет — `false`.
   */
  async lockRegistration(tx: DbSession, id: string): Promise<boolean> {
    const updated = await this.c.registrations.updateOne(
      { _id: id, status: 'active' },
      { $inc: { version: 1 } },
      { session: tx },
    );
    return updated.matchedCount === 1;
  }

  ticketsByRegistrations(registrationIds: readonly string[]): Promise<TicketDoc[]> {
    if (registrationIds.length === 0) return Promise.resolve([]);
    return this.c.tickets.find({ registrationId: { $in: [...registrationIds] } }).toArray();
  }

  async findByCode(code: string): Promise<TicketDoc | undefined> {
    return (await this.c.tickets.findOne({ code })) ?? undefined;
  }

  async findByQrHash(qrHash: string): Promise<TicketDoc | undefined> {
    return (await this.c.tickets.findOne({ qrHash })) ?? undefined;
  }

  /** Свой билет по коду: чужой и несуществующий неразличимы. */
  async findOwnByCode(userId: string, code: string): Promise<TicketDoc | undefined> {
    return (await this.c.tickets.findOne({ code, userId })) ?? undefined;
  }

  /** Последние билеты пользователя (`tickets_user_idx`). */
  ticketsOfUser(userId: string, max: number): Promise<TicketDoc[]> {
    return this.c.tickets.find({ userId }).sort({ createdAt: -1 }).limit(max).toArray();
  }

  /** Страница билетов события по `_id` ↑ (`tickets_event_idx`). */
  ticketsOfEvent(
    kind: TicketEventKind,
    eventId: string,
    afterId: string | null,
    limit: number,
  ): Promise<TicketDoc[]> {
    return this.c.tickets
      .find(afterId === null ? { kind, eventId } : { kind, eventId, _id: { $gt: afterId } })
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
  }

  /** Активные и отмеченные билеты события (сводка настроек). */
  async countsOfEvent(kind: TicketEventKind, eventId: string): Promise<TicketCounts> {
    const [active, checkedIn] = await Promise.all([
      this.c.tickets.countDocuments({ kind, eventId, status: 'active' }),
      this.c.tickets.countDocuments({ kind, eventId, status: 'checked_in' }),
    ]);
    return { active, checkedIn };
  }

  /** Отмена билета: только `active`; `false` — уже не активен (в транзакции — с `session`). */
  async cancelTicket(id: string, now: Date, session?: DbSession): Promise<boolean> {
    const updated = await this.c.tickets.updateOne(
      { _id: id, status: 'active' },
      { $set: { status: 'cancelled', cancelledAt: now }, $inc: { version: 1 } },
      { session },
    );
    return updated.modifiedCount === 1;
  }

  /** Билет регистрации — `cancelled` (в транзакции отмены регистрации). */
  async cancelTicketOfRegistration(
    tx: DbSession,
    registrationId: string,
    now: Date,
  ): Promise<void> {
    await this.c.tickets.updateOne(
      { registrationId, status: 'active' },
      { $set: { status: 'cancelled', cancelledAt: now }, $inc: { version: 1 } },
      { session: tx },
    );
  }

  /** Новая категория неотменённого билета (RC-T5): без нового письма и кода. */
  async setCategory(id: string, category: TicketCategoryDoc): Promise<void> {
    await this.c.tickets.updateOne(
      { _id: id, status: { $ne: 'cancelled' } },
      { $set: { category }, $inc: { version: 1 } },
    );
  }

  /** Отметка участника: условный переход `active → checked_in`; `null` — уже не активен (повтор, параллельный скан). */
  markCheckedIn(tx: DbSession, id: string, staffId: string, now: Date): Promise<TicketDoc | null> {
    return this.c.tickets.findOneAndUpdate(
      { _id: id, status: 'active' },
      {
        $set: { status: 'checked_in', checkedInAt: now, checkedInBy: staffId },
        $inc: { version: 1 },
      },
      { session: tx, returnDocument: 'after' },
    );
  }

  /** Активные билеты гонок пользователя → `cancelled` (стирание аккаунта); число. */
  async cancelRaceTicketsOf(userId: string, now: Date): Promise<number> {
    const updated = await this.c.tickets.updateMany(
      { userId, kind: 'race', status: 'active' },
      { $set: { status: 'cancelled', cancelledAt: now }, $inc: { version: 1 } },
    );
    return updated.modifiedCount;
  }

  // --- письмо (RC-T11) ---

  /**
   * Захват письма билета: `pending` или `sending` с истёкшим захватом → `sending` до `claimedUntil`. Нет билета или
   * письмо уже итоговое — `undefined`; живой чужой захват — `busy`.
   */
  async claimEmail(
    id: string,
    now: Date,
    claimedUntil: Date,
  ): Promise<{ status: 'claimed'; doc: TicketDoc } | { status: 'busy'; until: Date } | undefined> {
    const doc = await this.c.tickets.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { 'email.state': 'pending' },
          { 'email.state': 'sending', 'email.claimedUntil': { $lte: now } },
        ],
      },
      { $set: { 'email.state': 'sending', 'email.claimedUntil': claimedUntil } },
      { returnDocument: 'after' },
    );
    if (doc) return { status: 'claimed', doc };
    const held = await this.c.tickets.findOne(
      { _id: id, 'email.state': 'sending' },
      { projection: { 'email.claimedUntil': 1 } },
    );
    return held ? { status: 'busy', until: held.email.claimedUntil ?? now } : undefined;
  }

  /** Итог своего захвата (сверка по `claimedUntil`): `pending` — снять захват после сбоя SMTP. */
  async settleEmail(
    id: string,
    claimedUntil: Date,
    outcome:
      { state: 'sent'; sentAt: Date } | { state: Exclude<TicketEmailState, 'sent' | 'sending'> },
  ): Promise<void> {
    await this.c.tickets.updateOne(
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
}
