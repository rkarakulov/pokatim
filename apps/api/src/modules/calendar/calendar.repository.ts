import { Inject, Injectable } from '@nestjs/common';
import type { CalendarStartStatus, Discipline } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db, Filter } from 'mongodb';

import type { DbSession } from '../../db';
import { calendarCollections, type CalendarStartDoc } from './calendar.collection';

/** Позиция курсора: дата начала и `_id` последнего элемента страницы. */
export interface CalendarCursor {
  k: string;
  id: string;
}

/** Фильтр публичного списка — только примитивы после zod. */
export interface PublicCalendarFilter {
  from: string;
  disciplines?: readonly Discipline[];
  cityKeys?: readonly string[];
  /** Диапазоны месяцев `[first, last]` (даты) — старт пересекает хотя бы один. */
  months?: readonly { first: string; last: string }[];
}

/**
 * Единственный писатель `calendar_starts`. Условия — только по самому документу (без замков): изменение — по
 * ожидаемой `version` и статусу в фильтре (R3). Значения фильтров — примитивы после zod; регулярных выражений нет.
 */
@Injectable()
export class CalendarRepository {
  private readonly starts: Collection<CalendarStartDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.starts = calendarCollections(db).starts;
  }

  async find(id: string, session?: DbSession): Promise<CalendarStartDoc | undefined> {
    return (await this.starts.findOne({ _id: id }, { session })) ?? undefined;
  }

  /** Старты по id (`_id` — индекс); незнакомых — нет. */
  findMany(ids: readonly string[]): Promise<CalendarStartDoc[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.starts.find({ _id: { $in: [...new Set(ids)] } }).toArray();
  }

  /**
   * Замок старта в транзакции потребителя (`tickets`: регистрация и check-in): запись `admissionLock` без `version` —
   * конфликт записи с правкой, снятием и возвратом старта (`update` пишет тот же документ). Нет старта — `null`.
   */
  lockForAdmission(session: DbSession, id: string): Promise<CalendarStartDoc | null> {
    return this.starts.findOneAndUpdate(
      { _id: id },
      { $inc: { admissionLock: 1 } },
      { session, returnDocument: 'after' },
    );
  }

  async insert(session: DbSession, doc: CalendarStartDoc): Promise<void> {
    await this.starts.insertOne(doc, { session });
  }

  /** Изменение с ожидаемой версией и статусом; `null` — устарело. */
  update(
    session: DbSession,
    id: string,
    version: number,
    statusIn: readonly CalendarStartStatus[],
    set: Partial<Omit<CalendarStartDoc, '_id' | 'version'>>,
  ): Promise<CalendarStartDoc | null> {
    return this.starts.findOneAndUpdate(
      { _id: id, version, status: { $in: [...statusIn] } },
      { $set: set, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    );
  }

  /** Страница панели: новые даты сверху, `limit + 1` — признак продолжения. */
  listPanel(
    filter: { status?: CalendarStartStatus; discipline?: Discipline },
    after: CalendarCursor | null,
    limit: number,
  ): Promise<CalendarStartDoc[]> {
    const query: Filter<CalendarStartDoc> = {};
    if (filter.status) query.status = filter.status;
    if (filter.discipline) query.discipline = filter.discipline;
    if (after) {
      query.$or = [{ startsOn: { $lt: after.k } }, { startsOn: after.k, _id: { $lt: after.id } }];
    }
    return this.starts.find(query).sort({ startsOn: -1, _id: -1 }).limit(limit).toArray();
  }

  /**
   * Публичный список: опубликованные, не закончившиеся к `from` (`(endsOn ?? startsOn) ≥ from`), по
   * `(startsOn, _id)`. Внутри фильтра — ИЛИ, между фильтрами — И.
   */
  listPublic(
    filter: PublicCalendarFilter,
    after: CalendarCursor | null,
    limit: number,
  ): Promise<CalendarStartDoc[]> {
    const and: Filter<CalendarStartDoc>[] = [
      { status: 'published' },
      {
        $or: [{ endsOn: { $gte: filter.from } }, { endsOn: null, startsOn: { $gte: filter.from } }],
      },
    ];
    if (filter.disciplines?.length) and.push({ discipline: { $in: [...filter.disciplines] } });
    if (filter.cityKeys?.length) and.push({ cityKey: { $in: [...filter.cityKeys] } });
    if (filter.months?.length) {
      and.push({
        $or: filter.months.map(({ first, last }) => ({
          startsOn: { $lte: last },
          $or: [{ endsOn: { $gte: first } }, { endsOn: null, startsOn: { $gte: first } }],
        })),
      });
    }
    if (after) {
      and.push({
        $or: [{ startsOn: { $gt: after.k } }, { startsOn: after.k, _id: { $gt: after.id } }],
      });
    }
    return this.starts.find({ $and: and }).sort({ startsOn: 1, _id: 1 }).limit(limit).toArray();
  }

  /** Опубликованный старт по id (публичная карточка). */
  async findPublished(id: string): Promise<CalendarStartDoc | undefined> {
    return (await this.starts.findOne({ _id: id, status: 'published' })) ?? undefined;
  }

  /**
   * Города будущих опубликованных стартов: один на `cityKey` (написание — из самого раннего старта), по алфавиту
   * (collation `ru`), не больше `cap`.
   */
  async cities(from: string, cap: number): Promise<string[]> {
    const rows = await this.starts
      .aggregate<{ city: string }>(
        [
          {
            $match: {
              status: 'published',
              $or: [{ endsOn: { $gte: from } }, { endsOn: null, startsOn: { $gte: from } }],
            },
          },
          { $sort: { startsOn: 1, _id: 1 } },
          { $group: { _id: '$cityKey', city: { $first: '$city' } } },
          { $sort: { city: 1 } },
          { $limit: cap },
          { $project: { _id: 0, city: 1 } },
        ],
        { collation: { locale: 'ru' } },
      )
      .toArray();
    return rows.map((row) => row.city);
  }

  /**
   * Месяцы будущих опубликованных стартов (`YYYY-MM`, возр., ≤ `cap`): многодневный даёт месяц начала и месяц
   * конца; месяцы раньше месяца `from` (идущий многодневный, начавшийся в прошлом месяце) не попадают.
   */
  async months(from: string, cap: number): Promise<string[]> {
    const rows = await this.starts
      .aggregate<{ _id: string }>([
        {
          $match: {
            status: 'published',
            $or: [{ endsOn: { $gte: from } }, { endsOn: null, startsOn: { $gte: from } }],
          },
        },
        {
          $project: {
            _id: 0,
            m: [
              { $substrBytes: ['$startsOn', 0, 7] },
              { $substrBytes: [{ $ifNull: ['$endsOn', '$startsOn'] }, 0, 7] },
            ],
          },
        },
        { $unwind: '$m' },
        { $match: { m: { $gte: from.slice(0, 7) } } },
        { $group: { _id: '$m' } },
        { $sort: { _id: 1 } },
        { $limit: cap },
      ])
      .toArray();
    return rows.map((row) => row._id);
  }
}
