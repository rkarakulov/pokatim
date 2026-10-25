import { Inject, Injectable } from '@nestjs/common';
import {
  addLocalDays,
  type CalendarStartInput,
  type CalendarStartStatus,
  LocalDate,
  type PanelCalendarPage,
  type PanelCalendarQuery,
  type PanelCalendarStart,
  type RepublishCalendarStartRequest,
  type UnpublishCalendarStartRequest,
  type UpdateCalendarStartRequest,
} from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';

import { type DbSession, MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { PanelAudit } from '../panel';
import { type CalendarStartDoc, cityKeyOf } from './calendar.collection';
import { CalendarRepository } from './calendar.repository';

/** Многодневный старт — не длиннее 14 дней (`[ASSUMPTION]`). */
export const CALENDAR_MAX_DAYS = 14;

type CalendarField = keyof CalendarStartInput;
const CALENDAR_FIELDS: readonly CalendarField[] = [
  'title',
  'startsOn',
  'endsOn',
  'startTime',
  'discipline',
  'city',
  'place',
  'distancesKm',
  'registrationUrl',
  'description',
];

const fieldsError = (path: string, code: 'DATE_ORDER' | 'INVALID') =>
  domainError('VALIDATION_FAILED', 400, { fields: [{ path, code }] });

/** Порядок и длительность многодневного старта. */
function checkDates(startsOn: string, endsOn: string | null): void {
  if (endsOn === null) return;
  if (endsOn < startsOn) throw fieldsError('endsOn', 'DATE_ORDER');
  if (endsOn > addLocalDays(startsOn, CALENDAR_MAX_DAYS)) throw fieldsError('endsOn', 'INVALID');
}

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, index) => item === b[index])
    : a === b;

/**
 * Календарь стартов в панели (`calendar.manage`): запись публикуется сразу; «Снять с публикации» (причина — в
 * журнал) и «Вернуть в календарь». Изменения — по ожидаемой `version` (R3), каждое — одна запись журнала.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly repository: CalendarRepository,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(query: PanelCalendarQuery): Promise<PanelCalendarPage> {
    const after = query.cursor ? decodeCursor(query.cursor, LocalDate) : null;
    const docs = await this.repository.listPanel(
      { status: query.status, discipline: query.discipline },
      after,
      query.limit + 1,
    );
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toPanelCalendarStart),
      nextCursor: docs.length > query.limit && last ? encodeCursor(last.startsOn, last._id) : null,
    };
  }

  async get(id: string): Promise<PanelCalendarStart> {
    const doc = await this.repository.find(id);
    if (!doc) throw domainError('NOT_FOUND', 404);
    return toPanelCalendarStart(doc);
  }

  async create(actorUserId: string, input: CalendarStartInput): Promise<PanelCalendarStart> {
    checkDates(input.startsOn, input.endsOn);
    const now = this.clock.now();
    const doc: CalendarStartDoc = {
      _id: uuidv7(),
      status: 'published',
      ...input,
      cityKey: cityKeyOf(input.city),
      createdByUserId: actorUserId,
      createdAt: now,
      updatedAt: now,
      unpublishedAt: null,
      version: 0,
    };
    await this.transactions.run(async (tx) => {
      await this.repository.insert(tx, doc);
      await this.audit.append(tx, {
        action: 'calendar.created',
        actor: { kind: 'user', userId: actorUserId },
        subject: { kind: 'calendar_start', id: doc._id, label: doc.title },
      });
    });
    return toPanelCalendarStart(doc);
  }

  async update(
    actorUserId: string,
    id: string,
    input: UpdateCalendarStartRequest,
  ): Promise<PanelCalendarStart> {
    const doc = await this.transactions.run(async (tx) => {
      const current = await this.current(tx, id, input.version);
      const patch = Object.fromEntries(
        CALENDAR_FIELDS.filter((field) => input[field] !== undefined).map((field) => [
          field,
          input[field],
        ]),
      ) as Partial<CalendarStartInput>;
      const next: CalendarStartInput = { ...pick(current), ...patch };
      const changed = CALENDAR_FIELDS.filter((field) => !same(current[field], next[field]));
      if (changed.length === 0) return current;
      checkDates(next.startsOn, next.endsOn);
      return this.write(tx, actorUserId, current, input.version, {
        action: 'calendar.updated',
        set: { ...next, cityKey: cityKeyOf(next.city), updatedAt: this.clock.now() },
        details: { changedFields: changed },
      });
    });
    return toPanelCalendarStart(doc);
  }

  async unpublish(
    actorUserId: string,
    id: string,
    input: UnpublishCalendarStartRequest,
  ): Promise<PanelCalendarStart> {
    const doc = await this.transactions.run(async (tx) => {
      const current = await this.current(tx, id, input.version, 'published');
      const now = this.clock.now();
      return this.write(tx, actorUserId, current, input.version, {
        action: 'calendar.unpublished',
        set: { status: 'unpublished', unpublishedAt: now, updatedAt: now },
        reason: input.reason,
      });
    });
    return toPanelCalendarStart(doc);
  }

  async republish(
    actorUserId: string,
    id: string,
    input: RepublishCalendarStartRequest,
  ): Promise<PanelCalendarStart> {
    const doc = await this.transactions.run(async (tx) => {
      const current = await this.current(tx, id, input.version, 'unpublished');
      return this.write(tx, actorUserId, current, input.version, {
        action: 'calendar.republished',
        set: { status: 'published', unpublishedAt: null, updatedAt: this.clock.now() },
      });
    });
    return toPanelCalendarStart(doc);
  }

  /** Запись в транзакции: нет — 404, не тот статус или устаревшая версия — 409 `CONFLICT`. */
  private async current(
    tx: DbSession,
    id: string,
    version: number,
    status?: CalendarStartStatus,
  ): Promise<CalendarStartDoc> {
    const doc = await this.repository.find(id, tx);
    if (!doc) throw domainError('NOT_FOUND', 404);
    if ((status && doc.status !== status) || doc.version !== version) {
      throw domainError('CONFLICT', 409);
    }
    return doc;
  }

  private async write(
    tx: DbSession,
    actorUserId: string,
    current: CalendarStartDoc,
    version: number,
    change: {
      action: 'calendar.updated' | 'calendar.unpublished' | 'calendar.republished';
      set: Partial<Omit<CalendarStartDoc, '_id' | 'version'>>;
      details?: { changedFields: string[] };
      reason?: string;
    },
  ): Promise<CalendarStartDoc> {
    const updated = await this.repository.update(
      tx,
      current._id,
      version,
      [current.status],
      change.set,
    );
    if (!updated) throw domainError('CONFLICT', 409);
    await this.audit.append(tx, {
      action: change.action,
      actor: { kind: 'user', userId: actorUserId },
      subject: { kind: 'calendar_start', id: current._id, label: updated.title },
      reason: change.reason ?? null,
      details: change.details ?? null,
    });
    return updated;
  }
}

function pick(doc: CalendarStartDoc): CalendarStartInput {
  return {
    title: doc.title,
    startsOn: doc.startsOn,
    endsOn: doc.endsOn,
    startTime: doc.startTime,
    discipline: doc.discipline,
    city: doc.city,
    place: doc.place,
    distancesKm: doc.distancesKm,
    registrationUrl: doc.registrationUrl,
    description: doc.description,
  };
}

export function toPanelCalendarStart(doc: CalendarStartDoc): PanelCalendarStart {
  return {
    id: doc._id,
    status: doc.status,
    ...pick(doc),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    version: doc.version,
  };
}
