import { z } from 'zod';

import { PageQuery, Uuid } from '../common.ts';
import { RaceCancelReason } from '../races/race.schema.ts';
import { PanelRole } from './permissions.schema.ts';

/** Действия журнала панели (append-only). Значения только добавляются в конец (R6). */
export const AUDIT_ACTIONS = [
  'panel.role_granted',
  'panel.role_changed',
  'panel.role_revoked',
  'panel.signed_in',
  'panel.signed_out',
  // admin-02: сезоны, гонки, календарь стартов
  'season.created',
  'season.updated',
  'race.created',
  'race.updated',
  'race.published',
  'race.cancelled',
  'race.discarded',
  'calendar.created',
  'calendar.updated',
  'calendar.unpublished',
  'calendar.republished',
  // race-results-01: маршруты команды платформы
  'route.created',
  // race-results-05: протокол гонки (перепроверка после публикации — `recheck_requested` с ревизией)
  'results.attempt_excluded',
  'results.attempt_restored',
  'results.recheck_requested',
  'results.protocol_published',
  'results.result_disqualified',
  'results.disqualification_revoked',
  'results.recalculation_applied',
  // 05b: модерация кофе-райдов
  'ride.hidden',
  'ride.restored',
  'ride.reports_dismissed',
  // race-results-06: решение по спору
  'disputes.decided',
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
  subjectId: Uuid.optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

/** Вид объекта записи журнала (доменные модули панели); только в конец. */
export const AUDIT_SUBJECT_KINDS = ['season', 'race', 'calendar_start', 'route', 'ride'] as const;
export const AuditSubjectKind = z.enum(AUDIT_SUBJECT_KINDS);
export type AuditSubjectKind = z.infer<typeof AuditSubjectKind>;

/** Объект действия: `label` — название на момент действия (снимок, R7). Старые записи — `null`. */
export const AuditSubject = z.object({ kind: AuditSubjectKind, id: Uuid, label: z.string() });
export type AuditSubject = z.infer<typeof AuditSubject>;

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
  subject: AuditSubject.nullable(),
  details: z
    .object({
      roleFrom: PanelRole.optional(),
      roleTo: PanelRole.optional(),
      /** Имена изменённых полей (без значений). */
      changedFields: z.array(z.string()).optional(),
      cancelReason: RaceCancelReason.optional(),
      /** race-results-05: попытка, заявка участника, ревизия протокола */
      attemptId: Uuid.optional(),
      entryId: Uuid.optional(),
      revision: z.number().int().optional(),
      /** Модерация райдов: число жалоб, закрытых этим действием. */
      reportCount: z.number().int().nonnegative().optional(),
      /** race-results-06: спор, по которому принято решение */
      disputeId: Uuid.optional(),
    })
    .nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditPage = z.object({ items: z.array(AuditEntry), nextCursor: Uuid.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;
