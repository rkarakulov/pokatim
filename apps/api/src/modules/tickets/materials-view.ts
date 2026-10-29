import type { EventMaterial, EventMaterialAdmin } from '@pokatim/contracts';

import type { EventMaterialDoc } from './materials.collection';

/** Материал в ответе приложения: явный список полей, без версии, дат и сотрудников. */
export const materialView = (doc: EventMaterialDoc): EventMaterial => ({
  id: doc._id,
  type: doc.type,
  title: doc.title,
  description: doc.description,
  url: doc.url,
  file: doc.file ? { id: doc.file.id, name: doc.file.name, size: doc.file.size } : null,
});

/** Материал в панели: + версия и дата правки. */
export const materialAdminView = (doc: EventMaterialDoc): EventMaterialAdmin => ({
  ...materialView(doc),
  type: doc.type,
  version: doc.version,
  updatedAt: doc.updatedAt.toISOString(),
});
