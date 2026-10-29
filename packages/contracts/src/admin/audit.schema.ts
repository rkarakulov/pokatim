import { z } from 'zod';

import { AppDecorId, AppThemeId } from '../appearance/appearance.schema.ts';
import { PageQuery, Uuid } from '../common.ts';
import { RaceCancelReason } from '../races/race.schema.ts';
import { RouteRejectionReason } from '../routes/route-publication.schema.ts';
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
  // race-results-06b: просмотр рядов пульса и мощности на разборе спора (раз в час на сотрудника и спор)
  'disputes.series_viewed',
  // profile-02: сброс публичного имени райдера модератором (имени в записи нет)
  'profile.name_reset',
  // routes-01: каталог маршрутов (правка города/покрытия опубликованного — `details.changedFields`)
  'route.published',
  'route.unpublished',
  'route.catalog_updated',
  // account-deletion: райдер удалил свой аккаунт (actor — сам райдер, subject `rider`, без e-mail и имени)
  'account.deleted',
  // app-themes: админ сменил тему приложения (subject `platform`, детали themeFrom/themeTo)
  'appearance.theme_changed',
  // race-results-07: admin изменил пол и/или год анкеты Verified (subject `rider`, `changedFields` без значений)
  'profile.verified_demographics_changed',
  // routes-06: модерация маршрутов райдеров (subject `route`, без имени автора)
  'route.submission_approved',
  'route.submission_rejected',
  'route.rider_hidden',
  'route.rider_restored',
  'route.rider_reports_dismissed',
  // halloween-decor: админ включил или выключил сезонный декор (subject `platform`, детали decorFrom/decorTo)
  'appearance.decor_changed',
  // profile-moderation: сброс фото и клуба райдера, отклонение жалоб на профиль (subject `rider`, без имени и клуба)
  'profile.avatar_reset',
  'profile.club_reset',
  'profile.reports_dismissed',
  // event-tickets: настройки билетов события (subject — гонка или старт календаря, `changedFields`) и отметка участника
  // (subject — событие, код билета в `details.ticketCode`, без имени и e-mail)
  'tickets.settings_updated',
  'tickets.checked_in',
  // event-tickets PR C: материалы события (subject — событие; правка — `changedFields`)
  'tickets.material_added',
  'tickets.material_updated',
  'tickets.material_removed',
  'tickets.materials_reordered',
  // erasure-failures: admin поставил повтор фоновой очистки удалённого аккаунта (subject `rider`, без e-mail и имени)
  'account.erasure_retried',
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
export const AUDIT_SUBJECT_KINDS = [
  'season',
  'race',
  'calendar_start',
  'route',
  'ride',
  // profile-02: райдер (`id` — userId, `label` — «Участник ·<id>», без имени)
  'rider',
  // app-themes: настройка платформы (`id` — фиксированный nil UUID, `label` — название настройки)
  'platform',
] as const;
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
      /** app-themes: смена темы приложения */
      themeFrom: AppThemeId.optional(),
      themeTo: AppThemeId.optional(),
      /** halloween-decor: смена сезонного декора */
      decorFrom: AppDecorId.optional(),
      decorTo: AppDecorId.optional(),
      /** routes-06: код причины отклонения заявки (комментарий автору — в `reason`) */
      rejectionReason: RouteRejectionReason.optional(),
      /** event-tickets: код отмеченного билета */
      ticketCode: z.string().optional(),
    })
    .nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditPage = z.object({ items: z.array(AuditEntry), nextCursor: Uuid.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;
