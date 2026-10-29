import type { EventMaterialType, TicketEventKind } from '@pokatim/contracts';
import type { Binary, Collection, Db } from 'mongodb';

/**
 * Материалы событий (event-tickets PR C, ADR-0023 «Материалы»). Создаёт миграция `0039_event_materials`; единственный
 * писатель — `MaterialsRepository`.
 */
export const MATERIALS_COLLECTIONS = {
  materials: 'event_materials',
  files: 'event_material_files',
} as const;

/** Файл материала в документе материала (денормализация: список без чтения байтов). */
export interface MaterialFileRef {
  id: string;
  name: string;
  size: number;
}

/**
 * Материал события: `order` уникален в событии (индекс) — параллельные добавления конфликтуют, лимиты 20/10
 * проверяются без гонок. Содержимое — ссылка, файл или только текст (RC-C5).
 */
export interface EventMaterialDoc {
  _id: string;
  kind: TicketEventKind;
  eventId: string;
  type: EventMaterialType;
  title: string;
  description: string | null;
  url: string | null;
  file: MaterialFileRef | null;
  order: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

/** PDF материала: `_id` — `randomToken` (публичная отдача по негадаемому id, как аватары ADR-0019). */
export interface EventMaterialFileDoc {
  _id: string;
  kind: TicketEventKind;
  eventId: string;
  materialId: string;
  bytes: Binary;
  contentType: 'application/pdf';
  fileName: string;
  size: number;
  createdAt: Date;
  createdBy: string;
}

export interface MaterialsCollections {
  materials: Collection<EventMaterialDoc>;
  files: Collection<EventMaterialFileDoc>;
}

export function materialsCollections(db: Db): MaterialsCollections {
  return {
    materials: db.collection<EventMaterialDoc>(MATERIALS_COLLECTIONS.materials),
    files: db.collection<EventMaterialFileDoc>(MATERIALS_COLLECTIONS.files),
  };
}
