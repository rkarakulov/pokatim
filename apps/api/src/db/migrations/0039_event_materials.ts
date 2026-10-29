import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { MATERIALS_COLLECTIONS } from '../../modules/tickets/materials.collection';
import { ensureCollection } from './0002_identity';

/**
 * Материалы событий (event-tickets PR C): `event_materials` — индекс события по порядку, уникальный (одна позиция —
 * один материал); `event_material_files` — только чтение по `_id`; `event_material_locks` — замок мутаций материалов
 * события (лимиты без write skew), только `_id`. Вторичных индексов у файлов и замков нет. Expand-only, без бэкфилла,
 * идемпотентна. После `0038_tickets`.
 */
export const eventMaterials: MongoMigration = {
  id: '0039_event_materials',
  async up(db) {
    await ensureCollection(db, MATERIALS_COLLECTIONS.materials);
    await ensureCollection(db, MATERIALS_COLLECTIONS.files);
    await ensureCollection(db, MATERIALS_COLLECTIONS.locks);
    await db
      .collection(MATERIALS_COLLECTIONS.materials)
      .createIndex(
        { kind: 1, eventId: 1, order: 1 },
        { name: 'event_materials_event_order_unique', unique: true },
      );
  },
};
