import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { PANEL_COLLECTIONS } from '../../modules/panel/panel.collection';

/** Имя индекса журнала по объекту действия (фильтр `subjectId`, новые сверху). */
export const PANEL_AUDIT_SUBJECT_INDEX = 'panel_audit_subject_idx';

/**
 * Журнал панели с объектом действия (admin-02): индекс `{ 'subject.id': 1, _id: -1 }`. Старые записи без `subject`
 * не меняются (читаются как `null`). Expand-only, без транзакции, идемпотентна.
 */
export const panelAuditSubject: MongoMigration = {
  id: '0006_panel_audit_subject',
  async up(db) {
    await db
      .collection(PANEL_COLLECTIONS.audit)
      .createIndex({ 'subject.id': 1, _id: -1 }, { name: PANEL_AUDIT_SUBJECT_INDEX });
  },
};
