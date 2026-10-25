import { z } from 'zod';

import { PageQuery, Uuid } from '../common.ts';
import { PanelRole } from './permissions.schema.ts';

/** Действия журнала панели (append-only). Значения только добавляются в конец (R6). */
export const AUDIT_ACTIONS = [
  'panel.role_granted',
  'panel.role_changed',
  'panel.role_revoked',
  'panel.signed_in',
  'panel.signed_out',
] as const;
export const AuditAction = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditAction>;

/**
 * `GET /v1/admin/audit` (`audit.read`) — новые сверху, курсор — `id` последней записи страницы. Лишние параметры
 * (`action[$ne]` и т. п.) — 400: в фильтр БД попадают только значения после схемы.
 */
export const AuditQuery = z.strictObject({
  ...PageQuery.shape,
  cursor: Uuid.optional(),
  action: AuditAction.optional(),
  actorUserId: Uuid.optional(),
  targetUserId: Uuid.optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

/** Запись журнала: кто (сотрудник или CLI), что, когда, над кем, причина. Без e-mail, IP и UA. */
export const AuditEntry = z.object({
  id: Uuid,
  at: z.iso.datetime(),
  action: AuditAction,
  actor: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), userId: Uuid, displayName: z.string() }),
    z.object({ kind: z.literal('cli') }),
  ]),
  target: z.object({ userId: Uuid, displayName: z.string() }).nullable(),
  reason: z.string().nullable(),
  details: z.object({ roleFrom: PanelRole.optional(), roleTo: PanelRole.optional() }).nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditPage = z.object({ items: z.array(AuditEntry), nextCursor: Uuid.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;
