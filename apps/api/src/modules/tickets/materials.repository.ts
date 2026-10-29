import { Inject, Injectable } from '@nestjs/common';
import type { TicketEventKind } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type EventMaterialDoc,
  type EventMaterialFileDoc,
  type MaterialsCollections,
  materialsCollections,
} from './materials.collection';
import { ticketingIdOf } from './tickets.collection';

/** Материал без служебных полей записи — для правки по версии. */
export type MaterialChanges = Partial<
  Pick<EventMaterialDoc, 'type' | 'title' | 'description' | 'url'>
>;

/** Байты PDF для отдачи. */
export interface MaterialFileBytes {
  bytes: Uint8Array;
  fileName: string;
}

/**
 * Единственный писатель `event_materials`, `event_material_files` и `event_material_locks` (event-tickets PR C). Каждый
 * фильтр материала — с `kind, eventId` (материал чужого события — как нет). Мутации набора материалов — под
 * `lockEvent`; порядок уникален в событии (индекс), поэтому перестановка — в два шага (временные отрицательные позиции).
 */
@Injectable()
export class MaterialsRepository {
  private readonly c: MaterialsCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = materialsCollections(db);
  }

  /**
   * Замок материалов события — первая операция транзакции добавления, перестановки и удаления: запись в общий документ
   * события (upsert, `$inc version`) — параллельная мутация того же события получает конфликт записи и повторяется
   * после коммита, лимиты 20/10 проверяются по актуальному списку (`.claude/rules/db.md`, write skew).
   */
  async lockEvent(session: DbSession, kind: TicketEventKind, eventId: string): Promise<void> {
    await this.c.locks.updateOne(
      { _id: ticketingIdOf(kind, eventId) },
      { $inc: { version: 1 }, $setOnInsert: { kind, eventId } },
      { session, upsert: true },
    );
  }

  /** Материалы события по порядку (индекс события). */
  listOf(kind: TicketEventKind, eventId: string, session?: DbSession): Promise<EventMaterialDoc[]> {
    return this.c.materials.find({ kind, eventId }, { session }).sort({ order: 1 }).toArray();
  }

  find(
    kind: TicketEventKind,
    eventId: string,
    id: string,
    session?: DbSession,
  ): Promise<EventMaterialDoc | null> {
    return this.c.materials.findOne({ _id: id, kind, eventId }, { session });
  }

  async insert(session: DbSession, doc: EventMaterialDoc): Promise<void> {
    await this.c.materials.insertOne(doc, { session });
  }

  async insertFile(session: DbSession, doc: EventMaterialFileDoc): Promise<void> {
    await this.c.files.insertOne(doc, { session });
  }

  /** Правка по ожидаемой версии; устарела или нет — `null`. */
  update(
    session: DbSession,
    kind: TicketEventKind,
    eventId: string,
    id: string,
    version: number,
    changes: MaterialChanges & { updatedAt: Date; updatedBy: string },
  ): Promise<EventMaterialDoc | null> {
    return this.c.materials.findOneAndUpdate(
      { _id: id, kind, eventId, version },
      { $set: changes, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    );
  }

  /** Удаление материала и его файла; нет — `null`. */
  async delete(
    session: DbSession,
    kind: TicketEventKind,
    eventId: string,
    id: string,
  ): Promise<EventMaterialDoc | null> {
    const removed = await this.c.materials.findOneAndDelete(
      { _id: id, kind, eventId },
      { session },
    );
    if (removed?.file) {
      await this.c.files.deleteOne({ _id: removed.file.id, materialId: id }, { session });
    }
    return removed;
  }

  /** Новый порядок: `ids` — полный набор материалов события (проверил сервис); версии содержимого не меняются. */
  async reorder(
    session: DbSession,
    kind: TicketEventKind,
    eventId: string,
    ids: readonly string[],
  ): Promise<void> {
    const step = (order: (index: number) => number) =>
      this.c.materials.bulkWrite(
        ids.map((id, index) => ({
          updateOne: {
            filter: { _id: id, kind, eventId },
            update: { $set: { order: order(index) } },
          },
        })),
        { session, ordered: true },
      );
    // уникальный порядок: сначала во временные позиции, затем в итоговые
    await step((index) => -(index + 1));
    await step((index) => index);
  }

  /** Байты PDF по id (без проверки события, как аватар); нет — `null`. */
  async findFile(id: string): Promise<MaterialFileBytes | null> {
    const doc = await this.c.files.findOne({ _id: id }, { projection: { bytes: 1, fileName: 1 } });
    return doc ? { bytes: doc.bytes.buffer, fileName: doc.fileName } : null;
  }
}
